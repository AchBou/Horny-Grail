# Security Notes

## API

- Public read endpoints remain unauthenticated by design.
- Write endpoints require the `x-api-key` header and the Lambda runtime `WRITE_API_KEY` value.
- The desktop uploader should use backend-issued presigned URLs rather than direct AWS credentials.
- API Gateway CORS origins are controlled by the `AllowedCorsOrigins` SAM parameter.
- Handlers validate image IDs as 64-character hex strings and image extensions against supported image formats.

## S3

The image bucket is external to the SAM stack, so bucket policy and IAM role permissions must be managed in AWS.

The backend role that serves `POST /api/uploads/sign` needs these S3 permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::horny-grail-bucket/files/*",
        "arn:aws:s3:::horny-grail-bucket/thumbnails/*"
      ]
    }
  ]
}
```

The metadata write/read Lambda role also needs DynamoDB access limited to the configured table:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:<region>:<account-id>:table/horny-grail-table"
    }
  ]
}
```

Do not grant broad `s3:*`, bucket-wide object access, or DynamoDB table CRUD permissions to backend roles.
