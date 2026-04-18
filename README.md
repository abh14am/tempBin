# 🛡️ TempBin - Secure Zero-Knowledge Pastebin

**TempBin** is a lightweight, self-hosted private pastebin application designed for maximum security and privacy. It uses **Zero-Knowledge Architecture**, meaning the server never sees your plain-text data.

---

## 🛠️ Tech Stack

- **Backend**: Python (FastAPI)
- **Database**: Redis Stack (for high-performance storage and search)
- **Frontend**: Vanilla JavaScript + CSS (Minimalist, lightweight UI)
- **Encryption**: Web Crypto API (AES-GCM + PBKDF2)
- **Deployment**: Docker & Docker Compose

---

## 🚀 Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed.

### 2. Deployment
Clone the repository and run:
```bash
docker-compose up -d --build
```

The application will be available at: `http://localhost:8000`

---

## 🔑 Admin Dashboard

Access the admin panel at: `http://localhost:8000/admin`

- **Username**: `admin`
- **Default Password**: `admin123.` (Check `docker-compose.yml` to change)


---

## 🔒 Security Architecture

TempBin follows a strict **Zero-Knowledge** model:
1. When you type a note, a random 256-bit AES key is generated in your browser.
2. The browser encrypts your text locally.
3. Only the *scrambled* ciphertext and its metadata (Title, Expiration) are sent to the Redis server.
4. The decryption key is appended to the URL after a `#`. Because it is after the hash, your browser **never** transmits this key to the server during requests.
5. Even the server administrator cannot read the content of the notes.
