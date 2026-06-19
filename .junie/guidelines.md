# Development Guidelines for HornyGrail Project

This document provides essential information for developers working on the HornyGrail project.

## Project Structure

The project consists of several main components:

1. **Front-end (SvelteKit)**: Located in the `front` directory
2. **Serverless Functions (AWS SAM)**: Located in the `serverless` and `functions` directories
3. **Local Development Environment**: Located in the `local` directory

## Build/Configuration Instructions

### Front-end (SvelteKit)

The front-end is built with SvelteKit and uses Vite as the build tool.

```bash
# Navigate to the front-end directory
cd front

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Serverless Functions (AWS SAM)

The project uses AWS Serverless Application Model (SAM) for deploying serverless functions.

#### Prerequisites:
- SAM CLI - [Install the SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- Node.js - [Install Node.js](https://nodejs.org/en/)
- Docker - [Install Docker](https://hub.docker.com/search/?type=edition&offering=community)

#### Deployment:

```bash
# Navigate to the functions or serverless directory
cd functions  # or cd serverless

# Build the application
sam build

# Deploy the application
sam deploy --guided
```

#### Local Testing:

```bash
# Start the API locally
sam local start-api

# Invoke a specific function
sam local invoke <FunctionName> --event events/event.json
```

## Testing Information

### Front-end Testing (Playwright)

The front-end uses Playwright for end-to-end testing.

#### Setup:

```bash
# Navigate to the front-end directory
cd front

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

#### Running Tests:

```bash
# Run all tests
npm test

# Run a specific test file
npx playwright test tests/example.test.js
```

#### Creating New Tests:

1. Create a new test file in the `front/tests` directory with a `.test.js` extension
2. Import the necessary Playwright modules:
   ```javascript
   import { expect, test } from '@playwright/test';
   ```
3. Write your test using the Playwright API:
   ```javascript
   test('example test - check page title', async ({ page }) => {
     await page.goto('/');
     
     const title = await page.title();
     expect(title.toLowerCase()).toContain('horny grail');
     
     console.log('Page title:', title);
   });
   ```

### Serverless Function Testing (Mocha)

The serverless functions use Mocha for unit testing.

#### Running Tests:

```bash
# Navigate to the function directory
cd functions/hello-world

# Install dependencies
npm install

# Run tests
npm run test
```

#### Creating New Tests:

1. Create a new test file in the `functions/<function-name>/tests/unit` directory
2. Use Mocha's describe and it functions to structure your tests:
   ```javascript
   'use strict';

   const app = require('../../app.js');
   const chai = require('chai');
   const expect = chai.expect;
   
   describe('Tests for my function', function () {
     it('should return the expected result', async () => {
       // Setup
       const event = {};
       const context = {};
       
       // Execute
       const result = await app.lambdaHandler(event, context);
       
       // Verify
       expect(result).to.be.an('object');
       expect(result.statusCode).to.equal(200);
     });
   });
   ```

## Additional Development Information

### Code Style

- The front-end uses Prettier for code formatting. Run `npm run format` in the `front` directory to format the code.
- Follow the existing code style in the serverless functions.

### Debugging

#### Front-end:
- Use the browser's developer tools to debug the front-end.
- Check the console for errors and warnings.

#### Serverless Functions:
- Use the SAM CLI to debug serverless functions locally:
  ```bash
  sam local invoke <FunctionName> --event events/event.json --debug-port 5858
  ```
- Connect your IDE's debugger to port 5858.

#### Logs:
- Use the SAM CLI to fetch logs from deployed Lambda functions:
  ```bash
  sam logs -n <FunctionName> --stack-name <StackName> --tail
  ```

### Deployment

- The front-end can be deployed to any static hosting service.
- The serverless functions are deployed to AWS using the SAM CLI.
- Make sure to update the API endpoints in the front-end when deploying to production.