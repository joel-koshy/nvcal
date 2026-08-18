#!/bin/bash

BASE_URL="http://localhost:8787"

echo "=== Signup ==="
echo "POST $BASE_URL/auth/signup"
echo "---"
SIGNUP_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}')

SIGNUP_HTTP_CODE=$(echo "$SIGNUP_RESULT" | tail -n1)
SIGNUP_BODY=$(echo "$SIGNUP_RESULT" | head -n -1)

echo "HTTP Status: $SIGNUP_HTTP_CODE"
echo "Response: $SIGNUP_BODY"
echo ""

echo "=== Login ==="
echo "POST $BASE_URL/auth/login"
echo "---"
LOGIN_RESULT=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}')

LOGIN_HTTP_CODE=$(echo "$LOGIN_RESULT" | tail -n1)
LOGIN_BODY=$(echo "$LOGIN_RESULT" | head -n -1)

echo "HTTP Status: $LOGIN_HTTP_CODE"
echo "Response: $LOGIN_BODY"
