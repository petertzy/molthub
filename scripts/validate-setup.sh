#!/bin/bash

# MoltHub Setup Validation Script
# Validates that the development environment is properly set up

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

print_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

print_error() {
    echo -e "${RED}✗ ${1}${NC}"
}

print_header() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}  ${1}${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
}

ERRORS=0

print_header "MoltHub - Setup Validation"

# Check Docker containers
print_info "Checking Docker containers..."
if docker ps --filter "name=moltbook-postgres-dev" --format "{{.Status}}" | grep -q "healthy"; then
    print_success "PostgreSQL container is running and healthy"
else
    print_error "PostgreSQL container is not running or not healthy"
    ERRORS=$((ERRORS + 1))
fi

if docker ps --filter "name=moltbook-redis-dev" --format "{{.Status}}" | grep -q "healthy"; then
    print_success "Redis container is running and healthy"
else
    print_error "Redis container is not running or not healthy"
    ERRORS=$((ERRORS + 1))
fi

# Check PostgreSQL connection
print_info "Testing PostgreSQL connection..."
if docker exec moltbook-postgres-dev pg_isready -U moltbook_user -d moltbook_dev > /dev/null 2>&1; then
    print_success "PostgreSQL is accepting connections"
else
    print_error "Cannot connect to PostgreSQL"
    ERRORS=$((ERRORS + 1))
fi

# Check Redis connection
print_info "Testing Redis connection..."
if docker exec moltbook-redis-dev redis-cli ping > /dev/null 2>&1; then
    print_success "Redis is accepting connections"
else
    print_error "Cannot connect to Redis"
    ERRORS=$((ERRORS + 1))
fi

# Check database schema
print_info "Verifying database schema..."
TABLE_COUNT=$(docker exec moltbook-postgres-dev psql -U moltbook_user -d moltbook_dev -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
if [ "$TABLE_COUNT" -ge 7 ]; then
    print_success "Database schema is loaded ($TABLE_COUNT tables found)"
else
    print_error "Database schema incomplete (found $TABLE_COUNT tables, expected at least 7)"
    ERRORS=$((ERRORS + 1))
fi

# Check environment file
print_info "Checking .env file..."
if [ -f .env ]; then
    print_success ".env file exists"
else
    print_error ".env file not found"
    ERRORS=$((ERRORS + 1))
fi

# Check node_modules
print_info "Checking dependencies..."
if [ -d node_modules ]; then
    print_success "Dependencies installed"
else
    print_error "node_modules not found. Run: npm install"
    ERRORS=$((ERRORS + 1))
fi

# Check build
print_info "Checking build..."
if [ -d dist ]; then
    print_success "Application is built"
else
    print_error "Build directory not found. Run: npm run build"
    ERRORS=$((ERRORS + 1))
fi

# Summary
echo ""
print_header "Validation Summary"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Your development environment is ready.${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Start the development server: npm run dev"
    echo "  2. Visit: http://localhost:3000"
    echo "  3. Check health endpoint: curl http://localhost:3000/health"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Found $ERRORS error(s). Please fix them before continuing.${NC}"
    echo ""
    echo -e "${BLUE}Quick fixes:${NC}"
    echo "  - Start Docker containers: npm run docker:dev:up"
    echo "  - Create .env file: cp .env.example .env"
    echo "  - Install dependencies: npm install"
    echo "  - Build application: npm run build"
    echo ""
    exit 1
fi
