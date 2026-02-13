#!/bin/bash

# MoltHub Quick Setup Script
# This script sets up the local development environment in one command

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

print_success() {
    echo -e "${GREEN}✓ ${1}${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
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

# Check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker is installed"
    
    # Check Docker Compose
    if ! command -v docker compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    print_success "Docker Compose is installed"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi
    print_success "Node.js is installed ($(node --version))"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
    print_success "npm is installed ($(npm --version))"
}

# Setup environment file
setup_env() {
    print_header "Setting Up Environment"
    
    if [ ! -f .env ]; then
        print_info "Creating .env file from .env.example..."
        cp .env.example .env
        
        # Update for development
        sed -i.bak 's/DATABASE_URL=.*/DATABASE_URL=postgresql:\/\/moltbook_user:moltbook_dev_password@localhost:5432\/moltbook_dev/' .env
        sed -i.bak 's/NODE_ENV=.*/NODE_ENV=development/' .env
        rm .env.bak 2>/dev/null || true
        
        print_success ".env file created"
    else
        print_success ".env file already exists"
    fi
}

# Install dependencies
install_dependencies() {
    print_header "Installing Dependencies"
    
    print_info "Installing npm packages..."
    npm install
    print_success "Dependencies installed"
}

# Start Docker services
start_docker() {
    print_header "Starting Docker Services"
    
    print_info "Starting PostgreSQL and Redis containers..."
    docker compose -f docker/docker-compose.dev.yml up -d
    
    print_info "Waiting for services to be healthy..."
    sleep 8
    
    # Check PostgreSQL
    if docker exec moltbook-postgres-dev pg_isready -U moltbook_user -d moltbook_dev > /dev/null 2>&1; then
        print_success "PostgreSQL is ready"
    else
        print_warning "PostgreSQL may not be ready yet, but continuing..."
    fi
    
    # Check Redis
    if docker exec moltbook-redis-dev redis-cli ping > /dev/null 2>&1; then
        print_success "Redis is ready"
    else
        print_warning "Redis may not be ready yet, but continuing..."
    fi
}

# Setup database
setup_database() {
    print_header "Setting Up Database"
    
    # The schema.sql is automatically loaded by docker-entrypoint-initdb.d
    print_success "Database schema initialized"
    
    # Run migrations if they exist
    if [ -f "scripts/migrate.ts" ]; then
        print_info "Running database migrations..."
        npm run db:migrate || print_warning "Migration failed or no migrations to run"
    fi
    
    # Seed database if seed script exists
    if [ -f "scripts/seed.ts" ]; then
        print_info "Seeding database with sample data..."
        npm run db:seed || print_warning "Seeding failed or no seed data"
    fi
}

# Build the application
build_app() {
    print_header "Building Application"
    
    print_info "Compiling TypeScript..."
    npm run build
    print_success "Application built successfully"
}

# Print next steps
print_next_steps() {
    print_header "Setup Complete! 🎉"
    
    echo ""
    echo -e "${GREEN}Your local development environment is ready!${NC}"
    echo ""
    echo -e "${BLUE}Available Commands:${NC}"
    echo ""
    echo "  Start development server:"
    echo "    npm run dev"
    echo ""
    echo "  View Docker logs:"
    echo "    npm run docker:dev:logs"
    echo ""
    echo "  Run tests:"
    echo "    npm test"
    echo ""
    echo "  Stop services:"
    echo "    npm run docker:dev:down"
    echo ""
    echo "  Clean up (remove volumes):"
    echo "    npm run docker:dev:clean"
    echo ""
    echo -e "${BLUE}Service URLs:${NC}"
    echo "  PostgreSQL: localhost:5432"
    echo "  Redis: localhost:6379"
    echo "  API (after 'npm run dev'): http://localhost:3000"
    echo ""
    echo -e "${BLUE}Database Credentials:${NC}"
    echo "  Database: moltbook_dev"
    echo "  User: moltbook_user"
    echo "  Password: moltbook_dev_password"
    echo ""
}

# Main execution
main() {
    clear
    print_header "MoltHub - Quick Setup"
    
    check_prerequisites
    setup_env
    install_dependencies
    start_docker
    setup_database
    build_app
    print_next_steps
}

# Run main function
main
