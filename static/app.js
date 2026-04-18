const API_BASE = '/api';

// Utility functions for ArrayBuffer <-> Base64 conversion
function bufferToBase64(buf) {
    const binstr = Array.prototype.map.call(new Uint8Array(buf), ch => String.fromCharCode(ch)).join('');
    // make url safe if needed? standard base64 is fine for URL Hash fragment
    return btoa(binstr); 
}

function base64ToBuffer(b64) {
    const binstr = atob(b64);
    const buf = new Uint8Array(binstr.length);
    for(let i=0; i<binstr.length; i++){
        buf[i] = binstr.charCodeAt(i);
    }
    return buf.buffer;
}

// PBKDF2 Key Derivation
async function deriveAesKey(masterKeyB64, password, saltBuffer) {
    const encoder = new TextEncoder();
    const keyMaterialStr = (password || "") + masterKeyB64;
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(keyMaterialStr),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    
    return await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// Crypto Utils
async function encryptText(text, passwordText) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    
    // Generate MasterKey
    const masterKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    const masterKeyB64 = bufferToBase64(masterKeyRaw);
    
    // Generate Salt
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = bufferToBase64(salt);
    
    // Derive AES Key
    const aesKey = await deriveAesKey(masterKeyB64, passwordText, salt);
    
    // Generate IV and encrypt
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        data
    );
    
    const cipherBase64 = bufferToBase64(cipherBuffer);
    const ivBase64 = bufferToBase64(iv);
    
    return {
        encryptedContent: `${ivBase64}:${cipherBase64}`,
        decryptionKey: masterKeyB64,
        salt: saltB64
    };
}

async function decryptText(encryptedString, masterKeyB64, passwordText, saltB64) {
    try {
        const [ivBase64, cipherBase64] = encryptedString.split(':');
        const iv = base64ToBuffer(ivBase64);
        const cipherBuffer = base64ToBuffer(cipherBase64);
        const saltBuffer = base64ToBuffer(saltB64);
        
        const aesKey = await deriveAesKey(masterKeyB64, passwordText, saltBuffer);
        
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(iv) },
            aesKey,
            cipherBuffer
        );
        
        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch(err) {
        throw new Error("Failed to decrypt data.");
    }
}

class App {
    constructor() {
        this.currentScreen = null;
        this.currentNoteId = null;
        
        // Setup Markdown with Highlight.js
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true
        });

        this.init();
    }

    async init() {
        lucide.createIcons();
        this.handleRouting();
        window.addEventListener('hashchange', () => this.handleRouting());
    }

    handleRouting() {
        const hash = window.location.hash;
        if (hash.startsWith('#/view/')) {
            const path = hash.replace('#/view/', '');
            // path should be NOTE_ID:KEY
            this.showScreen('view', path);
        } else {
            this.showScreen('editor');
        }
    }

    showScreen(screenName, param = null) {
        const container = document.getElementById('appContainer');
        const template = document.getElementById(`tpl-${screenName}`);
        
        if (!template) return;
        
        container.innerHTML = '';
        container.appendChild(template.content.cloneNode(true));
        
        this.currentScreen = screenName;
        lucide.createIcons();

        if (screenName === 'editor') {
            document.getElementById('urlBanner').style.display = 'none';
        }
        else if (screenName === 'view') {
            if (param) {
                const parts = param.split(':');
                this.currentNoteId = parts[0];
                const key = parts[1] + (parts[2] ? ':'+parts[2] : ''); // handle base64 trailing equal signs sometimes splitting wrongly
                
                // Reconstruct full key if it had a colon, but we actually split by first config
                const keyStr = param.substring(this.currentNoteId.length + 1);
                
                this.pendingViewData = { id: this.currentNoteId, key: keyStr };
                this.loadNoteMetaAndCheckAuth();
            }
        }
    }

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json'
        };

        const config = { ...options, headers };
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, config);
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Request failed');
            return data;
        } catch (err) {
            console.error(err);
            throw err;
        }
    }

    async saveNote() {
        const title = document.getElementById('noteTitle').value;
        const rawContent = document.getElementById('noteContent').value;
        const expiration = parseInt(document.getElementById('noteExpiration').value);
        const isBurn = document.getElementById('noteBurn').checked;
        const password = document.getElementById('notePassword').value;
        
        if (!rawContent.trim()) {
            alert('Content cannot be empty');
            return;
        }
        
        const btn = document.getElementById('sendBtn');
        const ogText = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader"></i> Working...';
        btn.disabled = true;
        lucide.createIcons();

        try {
            // Encrypt Content (AES-GCM + PBKDF2)
            const { encryptedContent, decryptionKey, salt } = await encryptText(rawContent, password);

            const payload = { 
                title: title, 
                content: encryptedContent, 
                tags: "", 
                expiration: expiration,
                is_burn: isBurn,
                has_password: !!password,
                salt: salt
            };

            const res = await this.request('/notes/', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            // Build absolute URL for the UI string
            const fullUrl = `${window.location.protocol}//${window.location.host}/#/view/${res.id}:${decryptionKey}`;
            
            // Show Success Banner (Don't navigate away, let user copy it right here like PrivateBin)
            const banner = document.getElementById('urlBanner');
            const urlLink = document.getElementById('urlHashText');
            urlLink.textContent = fullUrl;
            urlLink.href = fullUrl;
            banner.style.display = 'flex';
            
            // clear inputs
            document.getElementById('noteContent').value = '';
            document.getElementById('notePassword').value = '';
            this.currentNoteId = res.id;
            
            // clear title as well
            document.getElementById('noteTitle').value = '';

        } catch (err) {
            alert('Failed to save note: ' + err.message);
        } finally {
            btn.innerHTML = ogText;
            btn.disabled = false;
            lucide.createIcons();
        }
    }

    async loadNoteMetaAndCheckAuth() {
        try {
            const note = await this.request(`/notes/${this.pendingViewData.id}`);
            this.fetchedNote = note;
            
            if (note.has_password === "true") {
                document.getElementById('passwordOverlay').style.display = 'flex';
                document.getElementById('dialogPassword').focus();
            } else {
                this.executeDecryption("");
            }
        } catch (err) {
            document.getElementById('viewTitle').textContent = 'Note not found';
            document.getElementById('viewContent').innerHTML = '<p>The note may have expired or was burned after reading.</p>';
            document.getElementById('viewUrlBanner').style.display = 'none';
        }
    }

    async submitPassword() {
        const pwd = document.getElementById('dialogPassword').value;
        if (!pwd) return alert("Password cannot be empty");
        document.getElementById('passwordOverlay').style.display = 'none';
        this.executeDecryption(pwd);
    }

    async executeDecryption(passwordStr) {
        const note = this.fetchedNote;
        const key = this.pendingViewData.key;
        
        document.getElementById('viewTitle').textContent = note.title || 'Untitled';
        document.getElementById('viewDate').textContent = new Date(note.created_at * 1000).toLocaleString();
        
        let decryptedText = "";
        let banner = document.getElementById('viewUrlBanner');
        let statusMsg = document.getElementById('viewStatusMsg');

        try {
            if(!key) throw new Error("No key in URL");
            decryptedText = await decryptText(note.content, key, passwordStr, note.salt);
            
            // Check if it was a Burn message
            if (note.is_burn === "true") {
                statusMsg.textContent = "This message was successfully decrypted and has been permanently burned from the server.";
                banner.style.background = "#fee2e2";
                banner.style.borderColor = "#fecaca";
                banner.style.color = "#dc2626";
            } else {
                statusMsg.textContent = "Decrypted locally successfully.";
            }

        } catch(e) {
            decryptedText = "⚠️ **Decryption Failed**: Invalid password or corrupted URL key.";
            statusMsg.textContent = "Decryption Failed";
            banner.style.background = "#fee2e2";
            banner.style.borderColor = "#fecaca";
            banner.style.color = "#dc2626";
            
            if(note.has_password === "true") {
                // allow retry
                document.getElementById('passwordOverlay').style.display = 'flex';
                return;
            }
        }

        // Render HTML
        document.getElementById('viewContent').innerHTML = marked.parse(decryptedText);
        
        lucide.createIcons();
    }

    async deleteCurrentNote() {
        if (!this.currentNoteId || !confirm("Are you sure you want to delete this note?")) return;
        
        try {
            await this.request(`/notes/${this.currentNoteId}`, { method: 'DELETE' });
            
            if (this.currentScreen === 'editor') {
                document.getElementById('urlBanner').style.display = 'none';
            } else {
                window.location.hash = '';
            }
        } catch(err) {
            alert("Failed to delete");
        }
    }

    copyUrl() {
        const u = document.getElementById('urlHashText').href;
        navigator.clipboard.writeText(u);
    }
}

// Global instance
const app = new App();
