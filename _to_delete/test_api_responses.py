
import requests

# We know the server is at localhost:8000 based on previous context
# We need a token if it's protected.
# Let's try to get one if possible, or just try without first.
# From auth.js, we might see login details.
# User mentioned admin/admin earlier.

BASE_URL = "http://localhost:8000/api"

def test_api():
    # Try to login first to get a token
    try:
        login_resp = requests.post(f"{BASE_URL}/usuarios/login", data={"username": "admin", "password": "admin"})
        if login_resp.status_code == 200:
            token = login_resp.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            print("Login successful.")
        else:
            print(f"Login failed: {login_resp.status_code} {login_resp.text}")
            headers = {}
    except Exception as e:
        print(f"Could not login: {e}")
        headers = {}

    endpoints = ["/citas/", "/consultas/"]
    for ep in endpoints:
        print(f"\nTesting {ep}...")
        try:
            r = requests.get(f"{BASE_URL}{ep}", headers=headers)
            print(f"Status: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                print(f"Count: {len(data)}")
                if data:
                    print(f"First item: {data[0]}")
            else:
                print(f"Error: {r.text}")
        except Exception as e:
            print(f"Failed to fetch {ep}: {e}")

if __name__ == "__main__":
    test_api()
