# Security Policy

If you find a security issue in PetitMaker, please report it privately to [petit.maker@outlook.com](mailto:petit.maker@outlook.com), with `[SECURITY]` in the subject. We aim to acknowledge complete reports within 72 hours and keep you informed about investigation and remediation.

This policy defines the good-faith security research the project can authorize, the reporting process and coordinated disclosure arrangements.

## Supported versions

We maintain the latest deployment on the official sites. Please identify the site and app version in your report. For a problem found in an older build, include whether it also occurs in the current version. Fixes are delivered through site updates; we do not maintain long-term patch releases for older builds.

## Reporting a vulnerability

Send reports to [petit.maker@outlook.com](mailto:petit.maker@outlook.com), with `[SECURITY]` in the subject. Private reporting gives us time to assess the issue and coordinate a fix before public technical details make it easier to exploit.

## What to include

- The issue and its likely impact.
- The affected page, app version, browser and device.
- Reproduction steps and a minimal example where possible.
- Relevant screenshots or request details, with keys, personal information and unrelated material removed.

Describe provider behavior instead of sending real API keys. Use data and accounts you are entitled to use, and limit the report to information needed to investigate.

## How we handle your report

1. **Acknowledgement.** We aim to acknowledge a complete report within 72 hours and explain any information needed to reproduce it.
2. **Triage.** We reproduce the issue, assess its impact and share our initial assessment.
3. **Remediation.** We prepare a fix for confirmed issues and publish it through the current site. Our targets are a few days for critical issues, about two weeks for high-severity issues, and later updates according to impact for other issues.
4. **Disclosure.** We coordinate publication with you and offer attribution according to your preference after the fix is live.

These are working targets for a volunteer team, rather than service-level commitments. Reproduction conditions, complexity and third-party dependencies can affect timing. We will share significant updates, request any further information we need and explain if a report is out of scope or does not describe a vulnerability.

## Out of scope

The game itself and systems run by hosting, CDN, email and AI providers are governed by their own research policies. Our permission covers only the systems we control.

This policy does not authorize denial-of-service, load or stress testing, social engineering, physical attacks, unauthorized account or credential use, or intentional access to, modification of or extraction of other people's data.

Issues requiring an already compromised device, a malicious extension or another person's physical access are usually beyond what this application can resolve alone. We will still assess whether the project has a contributing issue it can fix.

## Coordinated disclosure

Please contact us before publishing technical details and allow reasonable time for investigation and remediation. We can agree on disclosure timing according to the impact and progress of the fix, reducing exposure while the issue remains exploitable.

## Safe harbor

We welcome proportionate validation with your own data in a local copy or an environment that does not affect others. Online testing should be limited to what is needed to demonstrate the issue, with care for service availability and other people's data.

For good-faith research that follows this policy within its authorized scope, we will not pursue or support legal action based on rights we control. This commitment covers only matters within our authority; it cannot replace applicable law or permission from third parties.

If testing unexpectedly exposes someone else's sensitive information, stop the relevant activity. Avoid further access, retention or distribution, and describe the exposure and its scope in your report.

Publishing `security.txt` supplies contact information and does not authorize testing beyond this policy's scope.

## Recognition

After a fix is live, we can credit you under your preferred name or keep your identity private. Please tell us your preference in the report.

## Affiliation

PetitMaker (谷地工坊) is an independent, unofficial map-planning project for *Petit Planet* (星布谷地). It is not affiliated with, endorsed by or sponsored by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.). Game-related names and materials belong to their respective rights holders.

## Further reading

The developer reference [docs/THREAT_MODEL.md](https://github.com/Stry233/PetitMaker/blob/main/docs/THREAT_MODEL.md) explains the application boundaries, key protection and Agent tool restrictions. It describes implementation and limitations without granting additional testing permission.
