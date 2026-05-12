# pointlogger

Discord bot that logs merit/points to Google Sheets and notifies promotions.

Getting started

1. Install dependencies

```bash
npm install
```

2. Create Google credentials

- Obtain a service account JSON from Google Cloud and save it as `credentials.json` in the project root.
- Ensure the service account has Sheets API access and that the target spreadsheet grants access to the service account email.

3. Create environment file

Copy `.env.example` to `.env` and fill in your `SPREADSHEET_ID` and `DISCORD_TOKEN`.

```bash
cp .env.example .env
# then edit .env
```

4. Run the bot

```bash
node index.js
```

Security

- Do NOT commit `credentials.json` or your `.env` file. Those are listed in `.gitignore`.

License

This project is provided under the MIT License. See `LICENSE`.
