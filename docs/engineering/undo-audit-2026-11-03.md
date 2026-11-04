# "Done · Undo" audit — 2026-11-03

Pattern: `useUndo().schedule()` (`src/components/app/ui/use-undo.ts`). The change shows at once, the server call waits 5 s, Undo cancels, leaving the page commits, a failure restores and says so. Toast: message + "Undo" action. Existing wording kept ("{name} archived." + Undo).

Out of scope (other sessions own them): Catalogue, Courses, Events, scheduling, People (`client/persons`, PersonPicker).

Rules used to decide: undo only where the server call can wait and nothing irreversible happens before it. Never for: anonymise, permanent delete of published or archived content, anything that sends email or money, security revocations that must act now, anything irreversible on a third party.

| Screen | Action | Before | Decision | Note |
|---|---|---|---|---|
| Posts | Delete never-published draft | undo | already | |
| Posts | Archive (single, bulk, phone sheet) | immediate | **undo (new)** | pending overlay on the row |
| Posts | Unpublish (single, bulk) | immediate | **undo (new)** | pending overlay |
| Posts | Restore / Publish again | immediate | no | going live is a deliberate act; Restore is itself the way back |
| Posts | Delete permanently (archived/published) | confirm | MUST NOT | permanent delete of published content |
| Posts | Featured star, topics, unpublish date | immediate | no | trivially re-togglable, not destructive |
| Home "Continue editing" | Delete draft | undo | already | |
| FAQ sets | Delete draft | undo | already | |
| FAQ sets | Archive | immediate | **undo (new)** | "in use" refusal shows its real message if the delayed call fails |
| FAQ sets | Delete permanently | confirm | MUST NOT | |
| FAQ set editor | Remove question | custom undo | already | autosaved, own undo |
| Media library (client + admin) | Delete | undo | already | |
| Internal tags | Delete tag | undo | already | |
| Documents | Archive (row menu, bulk bar) | confirm dialog | **undo (new)** | confirm dropped, Undo replaces it |
| Documents | Delete for good (archived) | confirm | MUST NOT | |
| Document editor | Archive | confirm | no | editor page shows archived state after the call; the list is where undo lives |
| Contact requests (Submissions) | Mark handled / new / archived (row, bulk, sheet) | immediate, optimistic | **undo (new)** | |
| Contact requests | Delete | confirm | no | personal data, permanent, confirm kept |
| Access groups | Archive | confirm dialog | **undo (new)** | confirm dropped; restore remains |
| Access groups | Set/change password, sign out everyone | confirm | MUST NOT | signs people out, password reveal |
| Users (client) | Archive person | confirm dialog | **undo (new)** | row leaves at once |
| Users (client) | Cancel invitation | immediate | **undo (new)** | invitation (and its email) was sent earlier; cancel only |
| Users (client) | Invite, Resend, Make owner | | MUST NOT | send email / transfer ownership |
| Connected apps | Disconnect | immediate | MUST NOT | tokens revoked at the third party; re-connect needs the app's consent |
| Connected apps | Pause / Resume | immediate | no | each is the undo of the other |
| Galleries (list) | Delete | confirm | MUST NOT | permanent delete (only unused galleries offered) |
| Gallery detail | Discard unpublished changes | confirm | MUST NOT | changes are lost, not recoverable |
| Setup checklist | Hide | immediate | no | the "Show" link right there is the undo |
| Form notifications (settings) | Remove recipient | immediate | no | re-adding sends a verification email; revision-guarded autosave screen with no toast |
| Support tickets (client/admin) | Delete screenshot, redact | confirm | MUST NOT | irreversible; ticket status changes notify people |
| Billing (client/admin) | all | | MUST NOT | money |
| Admin backlog | Delete item | confirm dialog | **undo (new)** | confirm dropped |
| Admin backlog | Status change | immediate | no | re-settable |
| Admin partners | Suspend | confirm | MUST NOT | security action on a third party's access, must act now |
| Admin partners | Rotate secret | confirm | MUST NOT | irreversible |
| Admin What's New / Announcements | Archive/publish (editor save) | form save | no | part of the editor save, publishing shows to clients |
| Admin projects / billing alerts / provisioning | all | | MUST NOT | provisioning, billing |
| Admin users | all | | no | no reversible destructive action found |
| Taxonomy term delete | Delete (term sheet) | confirm | no | removes the term from content; dialog explains usage |

Left with their confirm dialogs, now unused strings in the bundles: `clientDashboard.users.archiveConfirm.*`, `clientDashboard.access.groups.archiveConfirm.*`, `clientDashboard.documents.archiveConfirm.*` is still used by the document editor, `admin.backlog.confirmDelete.*`.

New strings: `docs/engineering/people-module/messages/l.{en,it,de}.json` — `undo` in `clientDashboard.submissions`, `.documents`, `.access`, `.users` and `admin.backlog`.
