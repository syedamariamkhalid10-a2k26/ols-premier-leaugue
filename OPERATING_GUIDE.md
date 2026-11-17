# Operating guide

For the sports department, the auction operator and club captains.

## Who uses what

| Person | Address | Device |
|---|---|---|
| Super Administrator | `/admin` | Laptop or desktop |
| Auction Operator | `/operator` | Laptop next to the stage |
| Club Captains (8) | `/captain` | Their own phone or a school tablet |
| Projector / LED screen | `/projector` | Computer connected to the projector, signed in with the **projector** account |
| Students | `/register` | Any phone or computer |
| Everyone | `/` | Public league website |

Everyone signs in at `/login` and is taken to their own screen.

---

## 1. Before the auction

1. **Create the season** — Season Management. A first season already exists; rename it if needed.
2. **Check the eight clubs** — Club Management. Upload the official logos and set the official colours. Placeholder crests are marked "Placeholder crest".
3. **Open registration** — Settings → Student registration → *Registration open*. Share the link `https://<your address>/register`. Students give only their full name, class/grade, photograph, preferred position and optional secondary position. Nobody chooses a club.
   - Registrations collected on paper or in a spreadsheet: Player Management → **Import Excel/CSV** (download the template first).
   - Photographs taken by the school: Player Management → **Upload photos**. Name each file after the student (`Ahmed Raza.jpg`) to match automatically, then check each match.
4. **Approve registrations** — Student Registrations. Approve, reject or edit each one. Only approved players can enter the auction.
5. **Captain accounts** — Captain Accounts → *Create account* for each club. Choose the registered player who captains the club. The password is shown once: print the login slip and hand it over privately.
   - In Auction Control choose whether captains count in the seven-player limit and whether captains are auctioned or assigned automatically (default: captain is one of the seven and is assigned automatically).
6. **Auction settings** — Auction Control. Defaults: 70,000 points per club, starting bid 500, minimum increase 200, 15-second countdown, 7 players (5 starting + 2 substitutes). Settings can be changed before the auction; once purchases exist the starting budget is locked (use a budget adjustment instead).
7. **Finalise the auction list** — Auction Control → *Add all approved players to the list*, then choose the order (Shuffle, By position, By name, or move players up and down). Check the message that compares players to place with squad places available.
8. **Captains test their accounts** — each captain signs in at `/login` on the device they will use. The operator console shows *Captain login: Ready* for every club that has an account.
9. **Open the projector** — on the projector computer sign in as the projector user, open `/projector` and press **F** for full screen.
10. **Back up** — Settings → Backups → *Back up now* and download a copy.

## 2. During the auction (operator)

1. Press **Start auction**. The projector shows *LIVE AUCTION*.
2. Press **Present next** (or *Present* beside any player). The player appears on the projector and on every captain's phone. Bids are not accepted yet.
3. Invite the player forward, then press **▶ Start bidding**. The 15-second countdown starts.
4. Captains tap **BID**. The button always shows the next valid bid (500, then 700, 900, 1,100 …). Each accepted bid updates every screen instantly and restarts the countdown.
5. When the countdown reaches zero, bidding closes and the screens show *Time up — awaiting confirmation*. **Nothing is sold automatically.**
6. Press **✓ CONFIRM SOLD**. The projector shows the SOLD announcement, the player flies to the winning club, its budget and squad count update.
7. The student walks to their new club's stand.
8. Present the next player. Repeat until the queue is empty.

**Useful controls**

| Situation | Button |
|---|---|
| Need a moment | **Pause** (bids are refused while paused), then **Resume** |
| Give captains more time | **Restart timer** |
| Nobody bids | **No bids → allocation** — the player waits under *Awaiting allocation* |
| Wrong player presented, no bids yet | **Return to queue** |
| A captain tapped by mistake | **Undo last bid** (needs the correction permission) |
| Players left without a club | *Awaiting allocation* tab: **Second round** to auction them again, **Allocate** to place one, or **Distribute all automatically** (needs the allocation permission) |

**Rules the system enforces for captains** — the auction must be live and bidding open, the bid must be at least the next valid bid, the club cannot outbid itself, the club must have enough points and a free squad place, and (by default) must keep enough points to fill its remaining places at the starting bid. The captain sees a clear reason whenever a bid is refused.

**If something goes wrong**

- *A captain's phone loses connection:* a red banner appears and the BID button is disabled. When the phone reconnects it shows the latest confirmed bid. A bid sent just before the drop is either confirmed or rejected by the server — never counted twice.
- *The operator laptop disconnects:* nothing confirmed is lost. Reconnect (or open `/operator` on another device) and carry on from the same player.
- *The projector freezes:* refresh the page. It reloads the current state.
- *The server restarts:* the current player, bids and countdown are restored from the database.

## 3. After the auction

1. Press **End auction** in the operator console.
2. Squad Management — check every squad. Corrections (reverse a sale, move a player, allocate, budget adjustment) need a reason and are recorded in the audit log.
3. Captains set their **starting five and substitutes** in *My Squad* on their phones (administrators can also do this in Squad Management).
4. Reports — download the squad report and auction history (Excel, CSV or PDF).
5. Settings → Public website — switch on **Squads and player names** (and photographs only if consent arrangements allow) to publish the club profiles.
6. Back up and download a copy.

## 4. Running the league

1. **Fixtures → Groups** — assign four clubs to each group, or use *Random draw*.
2. **Generate 12 group matches** (optionally with a start date and matches per day). Edit dates, times and venues as needed.
3. **Match Results** — after each match enter the score, goal scorers, assists, cards and player of the match, and tick *Publish*. The league table updates automatically.
4. **League Table** — shows points, head-to-head, goal difference and fair play. If clubs are still level on every tie-breaker, the table says *Tied — decide order*; choose the final order there.
5. **Generate semi-finals** (A1 v B2, B1 v A2) once all group matches are complete, then **Generate Grand Final** after the semi-finals. Knockout draws need a penalty shoot-out score.
6. Add club **achievements** (Club Management) and **announcements** (Settings) for the public website.

## 5. A new season

Season Management → **New season**. The eight clubs, their names, logos and colours continue. The new season starts with fresh registrations, captains, auction settings, squads, fixtures and standings. Previous seasons are never deleted and remain in the public **Archive** and in each club's history.

## Roles and permissions

- **Super Administrator** — everything.
- **Auction Operator** — runs the auction. Two optional permissions (User Management): *Undo accidental bids and cancel a presented player* and *Allocate unsold players to clubs*.
- **Club Captain** — bids for their own club only and manages their own lineup. Cannot change budgets, other clubs or auction records.
- **Projector** — read-only live auction screen. No controls, no private information.

## Privacy

- Students are asked only for name, class/grade, photograph and positions.
- Photographs are compressed and stripped of hidden location data when uploaded, and are only visible to signed-in staff and captains unless the administrator publishes them.
- The public website never shows administrator notes, registration status, budgets (unless chosen) or any other private record.
