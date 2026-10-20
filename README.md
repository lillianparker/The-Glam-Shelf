# The Glam Shelf

lending library for friend groups - everyone adds the physical books they own, marks what they've read or want to read, and records where each copy is: at home or being lent out. 

People sign in with their email + create password

** Currently sign-in links are acting a bit funky

---

## What's in this folder

| Path | What it is |
|---|---|
| `supabase/schema.sql` | Sets up the database and who's allowed to see what. You paste it into Supabase once. |
| `src/` | The website itself (React). |
| `src/config.js`, `src/Wordmark.jsx` | The site's name and logo. Change both (and `<title>` in `index.html`) if you rename it. |
| `.env.example` | Template for your two Supabase keys. |

---



In the app, click **Copy invite link** and send it. When a friend opens it and signs in, they join your library automatically.

---

- **Libraries (groups).** Each friend group is its own library. You only see books in libraries you've joined. You can start or join more than one and switch between them at the top. Haven't actually tried that yet.
- **Books and copies.** A title is stored once per library. If you and a friend both own *The Bell Jar*, it shows as one card with two copies.
- **Where a copy is.** The owner picks "At my home" or "With [friend]". For someone not on The Glam Shelf, choose "With someone else…" and type a name.
- **Read status and verdicts.** Read, Reading, Want to read, or None, per person per title. Once you've marked a book Read you can add a verdict: Loved it, It was good, It was fine, or Not for me. Everyone in the library sees everyone's, and the "Friends loved" filter shows the hits.
- **The line.** Tap **Get in line** on any copy. There's no approval step: being in line means you're borrowing it next. Whoever has the book sees "Fred is next" and taps **Gave it to Fred** when they hand it over, which moves the book to Fred and takes him off the line. If the book's at the owner's home, the owner hands it to the first person in line the same way.
- **Owners stay in charge.** The owner can move people up or down the line, take someone off it, or call the book home with the location menu. **Not lending this one** keeps a copy on the shelf but stops anyone from getting in line (it clears the current line).
- **For you.** A panel at the top lists what's waiting on you: books to pass on, books you're next for, and who's in line for your books.
- **Removing.** Only the owner can remove their copy. When the last copy of a title is removed, the title disappears too.
- **Live updates.** Changes your friends make show up without refreshing.

The access rules live in the database (`schema.sql`), not just in the website, so people can't see other libraries even by poking at the code.
