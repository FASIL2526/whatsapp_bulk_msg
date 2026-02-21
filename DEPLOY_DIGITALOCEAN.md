# DigitalOcean App Platform Deployment

I've configured the application to be ready for **DigitalOcean App Platform**. This approach uses a `Dockerfile` to ensure that all the complex Linux libraries (like `libnspr4`, `libnss3`, etc.) are installed automatically during deployment.

## 🚀 Deployment Steps

1. **Push Changes to GitHub:**
   Ensure the new `Dockerfile` and `.dockerignore` are in your main branch.

2. **Create a New App on DigitalOcean:**
   - Log in to DigitalOcean and go to **Apps**.
   - Click **Create App** and select your GitHub repository.
   - DigitalOcean will detect the `Dockerfile` automatically.

3. **Configure Environment Variables:**
   In the **Settings** or **App Spec** section, ensure you add:
   - `AUTH_SECRET`: A long random string.
   - `PORT`: `3000`

4. **Select Plan Type:**
   - I recommend at least the **Basic** plan with **1GB of RAM**. The free tier will NOT work for Chrome.

---

> [!TIP]
> Once your app is live on DigitalOcean, you can visit the provided URL, log in with `admin`/`admin`, and start your WhatsApp client!
