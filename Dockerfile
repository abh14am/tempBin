FROM python:3.11-slim

WORKDIR /app

#Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

#application files
COPY main.py db.py auth.py ./
COPY routers ./routers/
COPY static ./static/

# Environment Variables default (Override via docker-compose)
ENV REDIS_HOST=localhost
ENV REDIS_PORT=6379

# Expose FastAPI port
EXPOSE 8000

# Start command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
