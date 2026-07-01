# HornyGrail Frontend

Public SvelteKit app for browsing images, viewing a single image, and loading a random image.

The frontend now builds as an explicit static single-page app for S3 + CloudFront deployment.

## Current Behavior

- `/browse` uses randomized infinite scroll backed by `GET /api/browse/random`.
- `/random` loads a single random active item from the backend random index.
- `/image/[id]` fetches metadata by canonical hash `id` and builds the CloudFront file URL client-side.
- `/access` is a Svelte access-code route used by the protected CloudFront distribution.

## Configuration

Copy `.env.example` to `.env` and provide values for:

- `PUBLIC_API_BASE_URL`
- `PUBLIC_CLOUDFRONT_BASE_URL`

These values are required. The app no longer keeps source-code URL fallbacks.

For the protected CloudFront setup, point both values at the same protected distribution:

- `PUBLIC_API_BASE_URL=https://<protected-domain>/api`
- `PUBLIC_CLOUDFRONT_BASE_URL=https://<protected-domain>`

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm run test
```

## API Expectations

The browse page expects the backend randomized browse response shape:

```json
{
  "items": [],
  "seed": 0.4721,
  "cursor": "opaque-cursor",
  "wrapped": false,
  "hasMore": true
}
```

The frontend treats `cursor` as opaque and passes it back unchanged on subsequent browse requests.

## Deployment

The GitHub Actions workflow at `.github/workflows/front-deploy.yml` builds `front/`, uploads the static output to S3, and invalidates CloudFront.

Configure these GitHub Actions repository variables:

- `PUBLIC_API_BASE_URL`
- `PUBLIC_CLOUDFRONT_BASE_URL`
- `FRONTEND_AWS_REGION`
- `FRONTEND_S3_BUCKET`
- `FRONTEND_CLOUDFRONT_DISTRIBUTION_ID`
- `FRONTEND_DEPLOY_ROLE_ARN`

The workflow triggers on pushes to `main` that touch `front/**`, and it can also be run manually with `workflow_dispatch`.

The workflow uses GitHub Actions OIDC to assume the AWS role referenced by `FRONTEND_DEPLOY_ROLE_ARN`. No long-lived AWS access keys are required.

If you deploy the protected unified CloudFront distribution from the SAM stack, set:

- `PUBLIC_API_BASE_URL` to the stack output `ProtectedReadApiBaseUrl`
- `PUBLIC_CLOUDFRONT_BASE_URL` to the stack output `ProtectedReadMediaBaseUrl`
- `FRONTEND_CLOUDFRONT_DISTRIBUTION_ID` to the stack output `ProtectedReadDistributionId`

Unauthenticated visitors are served `/access`. The form posts the shared code to `/auth/session`; the auth Lambda sets CloudFront signed cookies and redirects back into the app.

### Deep-link routing

The app is deployed as a static SPA with a `200.html` fallback. The workflow also copies that fallback to `404.html`.

In the protected CloudFront setup, SPA routes are handled by a CloudFront viewer-request rewrite for the frontend origin, so S3 website hosting is not required on the frontend bucket.
