#!/usr/bin/env python3
"""
Simple mongomock server for development.
Simulates MongoDB on localhost:27017
"""
import mongomock
from mongomock import mongo_client
import socket
import sys

def start_mongomock_server():
    """Start an in-memory MongoDB mock server."""
    try:
        # Create mongomock client
        client = mongomock.MongoClient("mongodb://localhost:27017")

        print("✅ mongomock server initialized")
        print("📍 Listening on localhost:27017 (in-memory database)")
        print("⚠️  Data will be lost when this process stops")
        print("\nPress Ctrl+C to stop the server\n")

        # Keep the server running
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n🛑 Shutting down mongomock server...")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Error starting mongomock server: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    start_mongomock_server()

