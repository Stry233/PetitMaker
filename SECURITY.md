# Security Policy

**At a glance:** PetitMaker is an unofficial, fully client-side map editor for *Petit Planet*. If you have found a security problem, email [selka.craft@outlook.com](mailto:selka.craft@outlook.com) with the subject prefix **`[SECURITY]`**. We aim to acknowledge complete reports within 72 hours. Please give us a reasonable chance to fix an issue before disclosing it publicly. We offer a limited, scoped safe harbor for good-faith research (see below). This document is the **vulnerability-reporting policy**: how to reach us, what we promise, how we handle a report, and what is in and out of scope. The technical account of how the app is hardened is kept separately as developer documentation (see *Further reading*).

## Supported versions

PetitMaker is a static, single-page web app with no backend and no release train of long-lived versions. Only the **latest deployment** served from the official site is supported and will receive security fixes. Older builds you may have cached, forked, or self-hosted are not covered; update to the current deployment before reporting.

## Reporting a vulnerability

Report privately, by email, before any public disclosure:

- **Email:** [selka.craft@outlook.com](mailto:selka.craft@outlook.com)
- **Subject prefix:** `[SECURITY]` (so the report is routed and not lost in general mail)

Please do **not** open a public GitHub issue, post on social media, or otherwise disclose the problem until we have had a chance to respond and remediate.

## What to include

A complete report is one we can reproduce. Where you can, please include:

- a clear description of the issue and the security impact you believe it has;
- the exact URL, build, or commit where you observed it;
- step-by-step reproduction instructions, and a minimal proof of concept if you have one;
- affected browser / operating system / device;
- any relevant screenshots, request/response captures, or console output, with your own secrets (API keys, personal data) redacted.

If reproduction requires an AI-provider API key, describe the behavior rather than sending us your key. Never include third parties' personal data in a report.

## How we handle your report

We are a small volunteer team, so the times below are honest aims, not a service-level agreement or a promise. A report moves through four stages, and we tell you where it is:

1. **Acknowledgement.** We aim to confirm we have received a complete report within 72 hours. We will tell you if we need more information to reproduce it.
2. **Triage.** We reproduce the issue and assess its severity and impact. For example, we judge whether it exposes a stored API key, allows code execution in the page, or is a lower-impact hardening gap. We will share our initial view of the severity with you.
3. **Assessment and fix.** For a confirmed issue we prepare a fix. Because only the latest deployment is supported, a fix ships by updating the live site; there are no backported patch releases. Our aim, adjusted to what a volunteer team can do, is to remediate a **critical** issue within a few days, a **high**-severity issue within about two weeks, and a **moderate or low** issue on a best-effort basis in a later update. We keep you reasonably informed of progress and let you know when we consider the issue resolved.
4. **Disclosure.** We coordinate the timing of any public disclosure with you (see *Coordinated disclosure*), and, with your permission, credit you once the fix is live (see *Recognition*).

At each stage you can expect a real human reply, a plain statement of what we found, and notice of the next step. If an issue turns out to be out of scope or not a vulnerability, we will say so and explain why rather than leave you without an answer.

## Out of scope

The following are outside this policy and its safe harbor. Reporting them is welcome, but they are not issues we can act on here, and testing them is not authorized by us:

- **The game itself**: *Petit Planet* and anything operated by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.). Report those under their own programs.
- **Our third-party providers**: our hosting, edge / CDN, email, and the AI providers the tool can reach. Test those only under their own rules and programs.
- **Social engineering** of the team, our providers, or any person, and physical attacks against people or facilities.
- **Denial-of-service, load, or stress testing** against the site or its infrastructure.
- **Reports that require a compromised device, a malicious browser extension, or another person's physical access.** These are outside what any client-side app can defend, as the developer threat model explains (see *Further reading*).

## Coordinated disclosure

We ask for coordinated (responsible) disclosure: give us a reasonable opportunity to investigate and remediate before you disclose publicly. We are happy to coordinate timing and to credit you once a fix is live (see *Recognition* below). We will not take legal action against researchers who follow this policy and the safe-harbor terms.

## Safe harbor

We support good-faith security research and will not pursue or support legal action against you for research that follows this policy. This safe harbor is **scoped and limited**:

- **It applies only to systems we control**, namely the PetitMaker web application and its own deployment. It **excludes** systems we do not control, including miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.) and their properties, and our hosting, edge/CDN, and AI-provider vendors. Test those only under their own programs and rules.
- **It does not authorize:** denial-of-service (DoS/DDoS) or load/stress testing; social engineering of any person or of our vendors; physical attacks against people or facilities; or intentional access to, modification of, or exfiltration of data belonging to other users or to third parties.
- **Stop and report on sensitive data.** If a test unexpectedly exposes personal data, credentials, or other sensitive information, stop immediately, do not save or share it, and tell us in your report.
- **No immunity beyond our own.** We can only offer safe harbor for the rights that are ours to grant. This policy does not, and cannot, waive the rights of third parties or grant you immunity under laws or agreements we have no authority to grant it under. If in doubt, ask us first.
- **security.txt is not a testing license.** Publishing a `/.well-known/security.txt` file is a contact convenience; it **does not authorize** arbitrary or intrusive testing of our systems or anyone else's.

Acting in good faith within this scope, and following coordinated disclosure, is what keeps you within the safe harbor.

## Recognition

With your permission, we are glad to credit researchers who responsibly report valid issues. Tell us in your report how, or whether, you would like to be named; we will not publish your name without your consent.

## Affiliation

PetitMaker, whose Chinese name is 谷地工坊, is an independent, unofficial fan project. It is **not affiliated** with, endorsed by, or sponsored by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.). *Petit Planet*, whose Chinese name is 星布谷地, and related names and material are the property of their respective owners.

## Further reading

The technical threat model (how the build, headers/CSP, key vault, and agent tool sandbox are hardened, and the assumptions behind that hardening) is maintained separately as developer documentation in the repository at `docs/THREAT_MODEL.md`. It is reference material for contributors and reviewers and is not part of this reporting policy.
