# Second Mile ESE Compliance Visit — Stage 1

An installable web app (PWA) for compliance support visits. Plain HTML, CSS, and JavaScript. No external libraries, no AI calls, no Claude tokens during use.

## What works in Stage 1

- **App shell**: dashboard, navigation, autosave, offline interface (after first load over HTTPS).
- **Dashboard**: unfinished visits, outstanding findings, follow-ups due within 14 days.
- **School directory**: loaded with all 16 schools from the Second Mile School Contacts 2026–2027 list (6 Miami-Dade, 3 Palm Beach, 2 Hillsborough, 5 Lee), including principals, assistant principals, ESE and ESOL contacts, phones, and staff directory links. No emails were listed. Roles marked not publicly listed are noted on each school. The roster fills blanks only, so it never overwrites edits made in the app. You can also add, edit, deactivate, and reactivate schools; principal, assistant principal, ESE lead, and additional ESE contacts; visit history and open corrective actions per school; CSV import with a preview (Excel: save as CSV first).
- **New visit**: school (county and district fill in automatically), date, reviewer, visit type, review mode, and all six editable counts. The form saves as you type.
- **Individual student file review**: file-by-file with Student ID only, five ratings, conditional items, evidence checklists, notes, evidence references, rating history, and a finding panel for every Needs Improvement or Action Required rating.
- **Student file scoring**: per file and pooled across the visit, with not-reviewed counts and checklist progress.

## Not built yet

| Stage | Module |
|---|---|
| 2 | Schoolwide review, combined readiness score with weighting, corrective action tracker with a verification step before Resolved, follow-up visits that reference prior findings |
| 3 | Leadership report and separate student-level report (print and PDF), Review and Send email screen with an Outlook draft handoff |
| 4 | Checklist rules editor with version history, scoring method editor, district-specific checklist versions |

The nav marks these modules with their stage. Their screens say they are not built.

## How the checklist works

Rules live in `rules.js` (version `2026.10-draft1`). Each item has what to verify, where evidence is usually found, an evidence checklist, a suggested source, and display conditions.

- **Every source is marked Pending Verification.** The federal citations are starting points, not confirmed requirements. Florida-specific items (transition start age, age-16 items, notice timelines) need confirmation against the current rule before use.
- **District references are blank** until verified.
- **Conditional display**: initial IEPs hide the annual review and reevaluation timeline items; initial and reevaluation events show consent; transfer and amendment events add their own items; transition items appear at the age set in Settings (default 14, pending verification); age 16, 17, and 18 items appear by age; consultation, related services, alternate assessment, and agency items appear only when flagged on the file.
- **Adult students**: a "rights have transferred" flag reminds the reviewer that notices and consent apply to the student.
- **Evidence checks never set a rating.** The reviewer always chooses the rating.

## Findings

Choosing Needs Improvement or Action Required opens a finding with:

- a starting description and an evidence note built only from evidence checks you left unchecked (edit freely)
- **where the fix happens**: correct now in the folder or system, carry to the next IEP meeting, system limitation, or missing evidence
- responsible staff (prefilled from the school's ESE lead), target date, priority, and status

Findings flag what is still needed. Description, evidence, and corrective action are required; owner and target date are needed before finalizing.

## Scoring

- Meets = 100, Needs Improvement = 50, Action Required = 0 (editable in Settings).
- Not Applicable and Not Reviewed are excluded, and never counted as compliant.
- Scores are pooled by item across files, so files with more applicable items carry more weight. Percentages are never averaged.
- System-limitation findings are left out of scores by default, so locked fields are never held against staff (toggle in Settings).
- Critical Action Required findings stay listed on the visit page regardless of the score.
- Every score is labeled as an internal support indicator, not an official district rating or funding determination.

## Data and privacy

- **Demo mode (default)**: student IDs must start with `DEMO-`. Demo data saves in this browser only.
- **Production mode without a backend**: student IDs and file reviews stay in memory and clear when the app closes. Visit details and school records still save on the device.
- Nothing is sent anywhere. The service worker caches only the app files.

**Before real student records are used**, the organization must approve and provide a secure backend with authentication, role-based access, encrypted transmission and storage, audit logging, backups, retention controls, and approved email distribution. Stage 1 does not include one.

## Install and run

**Test on a computer**: in this folder run `python -m http.server 8000`, then open `http://localhost:8000`. Opening `index.html` directly also works, but offline mode and install need HTTPS or localhost.

**Host for staff**: place the folder on an organization-approved HTTPS static host (for example, Azure Static Web Apps in the Second Mile Microsoft 365 tenant). Ask IT which host is approved.

**iPhone**: open the hosted address in Safari, tap Share, then Add to Home Screen.

**Windows 11**: open the hosted address in Edge, then choose Apps > Install this site as an app.

## Files

`index.html`, `styles.css`, `rules.js`, `roster.js`, `app.js`, `manifest.webmanifest`, `service-worker.js`, ``.

Colors and fonts are CSS variables at the top of `styles.css`, so Second Mile Design System values can replace them in one place.

## Testing done

An automated run covered: visit creation and validation, county autofill, count steppers, demo ID enforcement, conditional items by event type, age, and flags, all five ratings, pooled scoring with exclusions, rating history, finding prefill and completeness flags, fix-location changes, next and finish navigation, saving, production-mode data stripping, school add, edit, contacts, deactivate, CSV parsing and import, and every route. Screens were checked at iPhone and desktop widths.
