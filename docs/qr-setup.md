# Turning on QR downloads

The photo booth's **heart download** works with no setup at all. It always
will — that path never touches a server.

The two **QR modes** need one thing switching on, and this is how.

---

## Why any of this is needed

A QR code is not a container. It is a very short piece of text drawn as
squares — about **3 kilobytes** at the absolute maximum.

A photo strip is **1–3 megabytes**. The live version is **10–30**.

So a QR code can never hold the picture. It can only hold a **link**, and a
link needs the file to exist somewhere a phone can reach. That is the whole
reason this page exists.

Once you finish these steps, saving by QR will:

1. ask this app for permission to upload,
2. send the file **straight from your browser to storage** — never through
   this app's server,
3. and put a link in the QR code that **stops working when the room does**.

Step 2 is not a detail. Vercel refuses request bodies over about 4.5MB, and a
live strip is far bigger, so a file routed through the app would simply fail.

---

## What you need

- Your Neon account (the same one holding the database)
- Your Vercel project
- About ten minutes

---

## Step 1 — Make a bucket

A bucket is just a folder that lives on the internet.

1. Open the [Neon Console](https://console.neon.tech) and pick this project.
2. Find **Object Storage** in the sidebar and create a bucket.
3. Name it something you will recognise: `festibooth-keepsakes`.
4. Keep it **private**. Do not enable public access.

Private is correct here and does not stop the QR working. The link the QR
carries is *signed* — it proves permission on its own, and it expires.

## Step 2 — Make a key pair

Storage credentials are a username and password for that bucket.

1. In the same Object Storage screen, create **access keys** for the bucket.
2. You will be shown an **Access Key ID** and a **Secret Access Key**.

**The secret is shown once.** Copy both somewhere safe before closing the
dialog. If you lose it, delete the pair and make another — you cannot look it
up again.

While you are there, note the **endpoint** (an `https://…` address) and the
**region** (often `auto`).

## Step 3 — Put them into Vercel

1. Open your project in Vercel → **Settings** → **Environment Variables**.
2. Add these five, for **Production, Preview and Development**:

| Name | Value |
|---|---|
| `NEON_STORAGE_ENDPOINT` | the endpoint from step 2 |
| `NEON_STORAGE_REGION` | `auto`, unless Neon showed something else |
| `NEON_STORAGE_BUCKET` | `festibooth-keepsakes` |
| `NEON_STORAGE_ACCESS_KEY_ID` | the access key ID |
| `NEON_STORAGE_SECRET_ACCESS_KEY` | the secret |

### The one rule you must not break

**Never put `NEXT_PUBLIC_` in front of any of these.**

That prefix is not a label. It is an instruction that compiles the value into
the JavaScript sent to every visitor's browser — where anyone can read it.
These keys grant **write access to your bucket**. The same rule already
applies to `DATABASE_URL` and your Cloudflare token.

If you ever see one of these names with `NEXT_PUBLIC_` on it, delete the
variable and rotate the key. Do not just rename it: it has already shipped.

## Step 4 — Allow the page to read the file (CORS)

This is the step that makes **Save to Photos** work, and without it the button
will fail while everything else looks fine.

Scanning a QR opens a page on *your* app, but the file lives on *storage* —
two different addresses. Browsers refuse to let one read the other's bytes
unless the second one says it is allowed. That is CORS, and it exists so a
malicious page cannot quietly read your files.

The share sheet needs the actual bytes, so the page has to fetch them, so
storage has to permit it.

In the Neon Console, on the bucket, set its CORS rules to:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3000
  }
]
```

Replace `YOUR-APP.vercel.app` with your real domain. Keep `localhost` if you
want the booth to work while developing.

`PUT` is there because the browser uploads directly to storage too — the app
never carries the file — so the upload needs the same permission as the read.

**If the Save button says the file could not be fetched, this is why.** The
plain download link underneath keeps working regardless: it is the browser
following a link rather than the page reading bytes, which needs no permission.

## Step 5 — Redeploy

Environment variables are read at build time, so an existing deployment will
not pick them up. In Vercel: **Deployments → the latest one → Redeploy**.

## Step 6 — Check it

Open a room, take some photos, and on the finished strip open **Save**.

- **"QR — photo strip"** should show a code within a second or two.
- Point a phone at it. The strip should download.

### If it says *"sharing by QR is not set up for this app yet"*

The app could not find the credentials. Almost always one of:

- a typo in a variable name (they are case-sensitive)
- the variable added to only one environment, not all three
- no redeploy since adding them

### If it says *"the upload was refused"*

The credentials were found but the bucket rejected the write. Check that the
key pair belongs to **that** bucket and has write permission.

---

## Running it locally

Copy the same five values into `.env.local`. That file is gitignored and must
stay that way — `.gitignore` already covers `.env*`, and this repository is
public.

`.env.local.example` lists the names with blank values, and is the only env
file that is ever committed.

---

## What this costs, and what it means

Files sit in the bucket until you sweep them. Nothing deletes them
automatically — the *link* expires after 24 hours, but the file remains.

A night of photos is a few megabytes; a night with live strips might be a
hundred. Worth emptying the bucket occasionally.

And the honest part: with QR turned on, **your photographs leave your
computers**. They sit in a private bucket that only your keys open, reachable
only through a signed link that dies with the room — but that is a different
promise from "the picture never left the browser", which is what the heart
download still gives you.

Both are available. The menu says which is which, every time.
