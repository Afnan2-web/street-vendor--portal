# Public deployment (Render)

The app uses Render Web Services and Render PostgreSQL in Singapore. `render.yaml` defines both resources, connects the database, enables production HTTPS cookies, and asks for an admin password as a private deploy-time value.

## Deploy

1. Put this project in a GitHub repository that your Render account can access.
2. In Render, choose **New → Blueprint**, connect that repository, and review the two paid resources in `render.yaml` before creating them.
3. When asked for `ADMIN_PASSWORD`, enter a unique password with at least 12 characters. Render stores it as a secret; the app stores only a salted password hash in PostgreSQL.
4. After the first deploy succeeds, open the Render URL. The admin review page is at `/admin.html`.
5. To use your own domain, add it under the web service's **Settings → Custom Domains** and follow Render's DNS instructions.

The Render free Postgres plan is temporary: Render says it expires after 30 days and has no backups. The blueprint therefore selects a paid Postgres plan. Review the current [Render pricing](https://render.com/pricing) and estimated charges in the Render dashboard before creating resources. A custom domain is optional and may have a separate registrar cost.

## Local development

Run `node server.js` with Node.js 20 or newer. Without `DATABASE_URL`, the app keeps its local development data in the ignored `data/` folder. For production, Render supplies `DATABASE_URL` and the app creates its PostgreSQL tables at startup.
