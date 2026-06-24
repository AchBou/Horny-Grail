# HornyGrail Project Improvement Tasks

This document contains a comprehensive list of actionable improvement tasks for the HornyGrail project. Each task is logically ordered and covers both architectural and code-level improvements.

## Architecture Improvements

### Configuration Management
- [x] Implement a centralized configuration management system
- [x] Move hardcoded values to environment variables
- [x] Standardize AWS region usage across services
- [ ] Create separate configuration files for development, testing, and production environments

### Security
- [x] Implement proper authentication and authorization for API write endpoints
- [ ] Review and secure S3 bucket permissions
- [x] Implement CORS policies for API endpoints
- [ ] Remove sensitive information from code (e.g., "my-awesome-very-secret-upload-bucket")
- [x] Implement input validation for API inputs
- [ ] Add rate limiting to API endpoints to prevent abuse

### Performance
- [ ] Implement caching for frequently accessed resources
- [x] Optimize thumbnail processing pipeline for local desktop uploads
- [x] Use AWS CloudFront for content delivery
- [x] Implement pagination for randomized browse resources
- [x] Review and optimize DynamoDB queries for random selection and randomized browse

### Scalability
- [ ] Implement a proper error handling and logging strategy
- [ ] Set up monitoring and alerting for the application
- [ ] Implement auto-scaling for serverless functions
- [ ] Consider using a message queue for asynchronous processing of uploads

## Code-Level Improvements

### Front-end (SvelteKit)

#### General
- [ ] Implement a state management solution (e.g., Svelte stores)
- [ ] Create a consistent design system and component library
- [ ] Implement responsive design for all pages
- [x] Add loading states for randomized browse and random image flows
- [ ] Implement proper error handling and user feedback

#### Components
- [ ] Refactor Button component to handle events properly
- [ ] Improve Thumbnail component with loading states and error handling
- [ ] Add descriptive alt text for images
- [ ] Implement a modal component for viewing full-size images
- [ ] Create reusable form components

#### Pages
- [ ] Improve layout with proper navigation
- [ ] Implement a 404 page for non-existent routes
- [ ] Add a footer with relevant information
- [ ] Implement proper meta tags for SEO

### Serverless Functions

#### General
- [ ] Standardize error handling across all functions
- [ ] Implement proper logging with different log levels
- [ ] Remove console.log statements from production code
- [x] Add input validation for all function parameters
- [x] Implement proper HTTP status codes for responses

#### get-random-image
- [x] Refactor to use a more efficient method for getting random items from DynamoDB
- [x] Remove scan-loop-based random selection logic
- [ ] Improve error handling with specific error messages
- [x] Fix potential infinite loop in random item selection

#### randomized browse
- [x] Add cursor-based randomized browse endpoint backed by a DynamoDB random index
- [x] Implement infinite scroll in the frontend using the randomized browse cursor
- [ ] Backfill `status` and `randomKey` for existing table items before relying on randomized browse in production
- [ ] Add a secondary browse mode for stable chronological listing if product needs change

#### image retrieval
- [ ] Implement content type detection based on file extension where raw image responses are served
- [x] Add validation for image ID parameter
- [ ] Improve error handling with specific error messages

### Local Development Environment

#### General
- [ ] Standardize path handling (currently mixing Windows and Unix styles)
- [ ] Implement proper error handling and recovery
- [ ] Add validation for uploaded files
- [ ] Improve logging with structured log format
- [x] Add repair flow for partial assets where metadata exists but S3 objects are missing

#### File Upload
- [ ] Refactor to use asynchronous file reading for better performance
- [ ] Improve file extension extraction to handle multiple dots
- [ ] Add validation for file types and sizes
- [ ] Implement retry logic for failed uploads

#### Thumbnail Generation
- [x] Generate image thumbnails with native Tauri code
- [x] Generate WebM thumbnails with native bundled ffmpeg
- [x] Add manual thumbnail regeneration for existing files
- [x] Maintain aspect ratio for square thumbnails
- [ ] Add support for different thumbnail sizes
- [x] Implement bounded timeouts and fallback handling for thumbnail generation and upload
- [ ] Add automated tests or fixtures for image and WebM thumbnail generation
- [ ] Decide whether to bundle smaller ffmpeg builds per platform to reduce installer size

## Testing and Documentation

### Testing
- [ ] Implement unit tests for all components and functions
- [ ] Set up integration tests for API endpoints
- [ ] Implement end-to-end tests for critical user flows
- [ ] Set up continuous integration to run tests automatically

### Documentation
- [ ] Create comprehensive API documentation
- [ ] Document the architecture and design decisions
- [ ] Add inline code documentation
- [ ] Create user documentation
- [x] Document deployment procedures
- [x] Document desktop thumbnail generation and local ffmpeg fetch behavior

## Build and Deployment

### Build Process
- [ ] Set up a proper build pipeline
- [ ] Implement code linting and formatting
- [ ] Add static code analysis
- [ ] Implement versioning strategy

### Deployment
- [x] Automate frontend deployment process
- [ ] Implement blue-green deployment for zero downtime
- [ ] Set up staging environment for testing before production
- [ ] Implement rollback procedures
