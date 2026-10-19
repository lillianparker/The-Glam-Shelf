# The Glam Shelf

A lending library for you and your friends. Everyone adds the physical books they own, marks what they've read or want to read, and records where each copy is: at home, or with a friend. Search a title and you'll see who has it.

People sign in with their email. There's no password: each sign-in sends a link to their inbox.

---

## What's in this folder

| Path | What it is |
|---|---|
| `supabase/schema.sql` | Sets up the database and who's allowed to see what. You paste it into Supabase once. |
| `src/` | The website itself (React). |
| `src/config.js`, `src/Wordmark.jsx` | The site's name and logo. Change both (and `<title>` in `index.html`) if you rename it. |
| `.env.example` | Template for your two Supabase keys. |

---

## Setup (about an hour the first time)

Supabase and Vercel occasionally rename menu items, so the labels below may differ slightly.

### 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and install it. This lets you run the site on your own computer.

### 2. Create the database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) and click **New project**. Pick any name and a strong database password (you won't need it again for this app).
2. When the project is ready, open **SQL Editor** in the left sidebar → **New query**.
3. Open `supabase/schema.sql` from this folder, copy everything, paste it in, and click **Run**. You should see "Success. No rows returned."

### 3. Turn on email sign-in

1. Go to **Authentication → Sign In / Providers** and make sure **Email** is enabled. (It is by default.)
2. Go to **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:5173` for now. You'll change it after step 6.
   - **Redirect URLs:** add `http://localhost:5173`.

### 4. Connect the website to the database

1. In Supabase, open **Project Settings → API** (sometimes called **API Keys**).
2. Copy the **Project URL** and the **anon / publishable** key. Never use the `service_role` or secret key here.
3. In this folder, make a copy of `.env.example` named `.env.local` and paste the two values in.

### 5. Run it on your computer

Open a terminal in this folder and run:

```
npm install
npm run dev
```

Open http://localhost:5173, sign in with your email, pick your name, and create your library.

### 6. Put it online (Vercel)

1. Put this folder on GitHub (GitHub Desktop is the easiest way if you're new to it). `.env.local` is excluded on purpose, so your keys stay off GitHub.
2. Sign up at [vercel.com](https://vercel.com) with your GitHub account → **Add New → Project** → choose the repo. Vercel detects it's a Vite app.
3. Before clicking Deploy, open **Environment Variables** and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values as your `.env.local`.
4. Click **Deploy**. You'll get an address like `the-glam-shelf.vercel.app`.
5. Back in Supabase → **Authentication → URL Configuration**: set **Site URL** to that address and add it to **Redirect URLs**.

Optional: buy a domain and connect it in Vercel under **Settings → Domains**, then add that address to Supabase's Redirect URLs too.

### 7. Set up a real email sender (do this before inviting friends)

Supabase's built-in email sender only allows a handful of emails per hour and is meant for testing. Once several friends are signing in, login emails will stop arriving. To fix it, connect a free email service:

1. Sign up for an email service such as [Resend](https://resend.com) and follow its steps to verify a sending address or domain.
2. In Supabase → **Authentication → Emails → SMTP Settings**, turn on custom SMTP and paste the details the service gives you.

While you're there, you can edit the **Magic Link** email template to say "Sign in to The Glam Shelf."

### 8. Invite your friends

In the app, click **Copy invite link** and send it. When a friend opens it and signs in, they join your library automatically.

---

## How it works

- **Libraries (groups).** Each friend circle is its own library. You only see books in libraries you've joined. You can start or join more than one and switch between them at the top.
- **Books and copies.** A title is stored once per library. If you and Ted both own *The Bell Jar*, it shows as one card with two copies.
- **Where a copy is.** The owner picks "At my home" or "With [friend]". For someone not on The Glam Shelf, choose "With someone else…" and type a name.
- **Read status and verdicts.** Read, Want to read, or Neither, per person per title. Once you've marked a book Read you can add a verdict: Loved it, It was fine, or Not for me. Everyone in the library sees everyone's, and the "Friends loved" filter shows the hits.
- **The line.** Tap **Get in line** on any copy. There's no approval step: being in line means you're borrowing it next. Whoever has the book sees "Fred is next" and taps **Gave it to Fred** when they hand it over, which moves the book to Fred and takes him off the line. If the book's at the owner's home, the owner hands it to the first person in line the same way.
- **Owners stay in charge.** The owner can move people up or down the line, take someone off it, or call the book home with the location menu. **Not lending this one** keeps a copy on the shelf but stops anyone from getting in line (it clears the current line).
- **For you.** A panel at the top lists what's waiting on you: books to pass on, books you're next for, and who's in line for your books.
- **Removing.** Only the owner can remove their copy. When the last copy of a title is removed, the title disappears too.
- **Live updates.** Changes your friends make show up without refreshing.

The access rules live in the database (`schema.sql`), not just in the website, so people can't see other libraries even by poking at the code.

---

## Ideas for later

- Email notifications ("You're next for The Bell Jar", "Fred got in line for your book"), using the same email service as login.
- Look up title, author and cover from an ISBN (Open Library has a free catalog), and scan barcodes with a phone camera.
- A reminder when a book has been out for a long time.
