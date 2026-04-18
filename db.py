import os
import redis.asyncio as redis
from redis.commands.search.field import TextField, TagField, NumericField
from redis.commands.search.index_definition import IndexDefinition, IndexType
from redis.exceptions import ResponseError
from typing import Optional, List, Dict, Any
import shortuuid
import time

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"

# Connection pool
redis_pool = redis.ConnectionPool.from_url(REDIS_URL, decode_responses=True)

def get_redis():
    return redis.Redis(connection_pool=redis_pool)

async def init_db():
    client = get_redis()
    try:
        # Create Search Index for our notes
        # Prefix "note:"
        schema = (
            TextField("title", weight=5.0),
            TextField("content", weight=1.0),
            TagField("tags"),
            NumericField("created_at", sortable=True)
        )
        definition = IndexDefinition(prefix=["note:"], index_type=IndexType.HASH)
        await client.ft("idx:notes").create_index(schema, definition=definition)
        print("Search index created.")
    except ResponseError as e:
        if "Index already exists" in str(e):
            print("Search index already exists.")
        else:
            print(f"Error creating index: {e}")
            raise e

async def create_note(title: str, content: str, tags: str, expiration_sec: Optional[int], is_burn: bool, has_password: bool, salt: str) -> str:
    client = get_redis()
    note_id = shortuuid.ShortUUID().random(length=8)
    now = int(time.time())
    
    key = f"note:{note_id}"
    data = {
        "id": note_id,
        "title": title or "",
        "content": content,
        "tags": tags or "",
        "created_at": now,
        "is_burn": "true" if is_burn else "false",
        "has_password": "true" if has_password else "false",
        "salt": salt or ""
    }
    
    # Store note
    await client.hset(key, mapping=data)
    
    # Set expiration if provided
    if expiration_sec and expiration_sec > 0:
        await client.expire(key, expiration_sec)
        
    # Add to recent list (sorted set by time)
    await client.zadd("recent_notes", {note_id: now})
    
    return note_id

async def get_note(note_id: str) -> Optional[Dict[str, str]]:
    client = get_redis()
    key = f"note:{note_id}"
    data = await client.hgetall(key)
    if not data:
        return None
        
    # Check if we should burn after reading based on some logic? 
    # For now, burn after read will be handled by the route if the user requested it. 
    return data

async def delete_note(note_id: str):
    client = get_redis()
    key = f"note:{note_id}"
    await client.delete(key)
    await client.zrem("recent_notes", note_id)

async def list_recent_notes(limit: int = 20) -> List[Dict[str, str]]:
    client = get_redis()
    # Get recent IDs
    note_ids = await client.zrevrange("recent_notes", 0, limit - 1)
    notes = []
    
    for nid in note_ids:
        # Retrieve full data
        data = await client.hgetall(f"note:{nid}")
        if data:
            notes.append(data)
        else:
            # Clean up dangling index
            await client.zrem("recent_notes", nid)
            
    return notes

async def search_notes(query: str) -> List[Dict[str, Any]]:
    client = get_redis()
    try:
        # Simple query using FT.SEARCH
        # If query is empty, return recent
        if not query.strip():
            return await list_recent_notes(limit=20)
            
        res = await client.ft("idx:notes").search(query)
        notes = []
        for doc in res.docs:
            data = doc.__dict__
            # remove doc id
            d = {k: v for k, v in data.items() if k != 'id' and k != 'payload'}
            # The doc id itself contains "note:xx"
            nid = doc.id.replace("note:", "")
            d["id"] = nid
            notes.append(d)
        return notes
    except Exception as e:
        print(f"Search error: {e}")
        return []

async def list_all_notes() -> List[Dict[str, Any]]:
    client = get_redis()
    try:
        res = await client.ft("idx:notes").search("*")
        notes = []
        for doc in res.docs:
            data = doc.__dict__
            d = {k: v for k, v in data.items() if k != 'id' and k != 'payload'}
            nid = doc.id.replace("note:", "")
            d["id"] = nid
            try:
                ttl = await client.ttl(doc.id)
                d["ttl"] = ttl
            except:
                d["ttl"] = -1
            notes.append(d)
        return notes
    except Exception as e:
        print(f"Error fetching all notes: {e}")
        return []
