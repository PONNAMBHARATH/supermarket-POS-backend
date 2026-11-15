# MarketFlow POS API

Express and TypeScript API with Prisma, MySQL 8.4 for local development, TiDB Cloud for hosted data, and Cloudflare R2 for images.

## Run locally with Docker

Create `.env` from the template and replace `JWT_SECRET` with a random secret of at least 32 characters.

```bash
cp -n .env.example .env
openssl rand -hex 32
docker compose up -d --build
curl --retry 10 --retry-connrefused --retry-delay 2 -fsS http://localhost:8080/health
docker compose exec api npm run seed
```

The API is at `http://localhost:8080/api/v1`. Swagger is at `http://localhost:8080/api-docs`. For a demo login, use `owner` and `ChangeMe123!`. The seed preserves an existing owner. Run `docker compose logs -f api db` to follow logs or `docker compose down` to stop the stack.

## Deploy with TiDB Cloud and Render

1. Create the `supermarket_pos` database in TiDB and set the MySQL connection URL in your private backend `.env` as `DATABASE_URL`. Keep `sslaccept=strict` in the URL.
2. Apply the schema from the backend repo. Local Compose uses its own MySQL service, so run the command directly on your machine.

   ```bash
   npm ci
   env -u DATABASE_URL npx prisma db push
   ```

3. Deploy the Dockerfile as a Render Web Service. Set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `TZ`, and the `OBJECT_STORAGE_*` settings in the service environment. Use the frontend's HTTPS origin for `CORS_ORIGIN` and `Asia/Kolkata` for `TZ` if the store uses India time.
4. Check the hosted `/health` endpoint and use the hosted `/api/v1` URL in the frontend. Use a unique owner password for a live deployment.

## Image uploads

Set the R2 S3 endpoint, bucket name, and bucket-scoped credentials in the backend environment. Set `OBJECT_STORAGE_PUBLIC_BASE_URL` to the public image origin and `OBJECT_STORAGE_PREFIX` to the folder name (default `products`). The owner-only `POST /api/v1/images` route accepts JPEG, PNG, or WebP bytes up to 5 MB and returns an `imageUrl` for the product or offer.

Keep real environment files local or in the host's environment settings. Commit only placeholder values in `.env.example`.
