# Privacy Policy

## At a Glance

This summary is provided for convenience and does not replace the full policy set out in the numbered sections below. {app} is a map-planning tool that runs entirely in your web browser. There are no user accounts, and your map projects are **not stored on a project-operated server**; they reside in your browser and in the files you choose to export. We display no advertising, set no advertising cookies, and perform no cross-site or cross-device tracking. The optional AI Agent and provider-backed illustration studio contact third-party AI services using API keys you supply; on-device illustration styles do not contact an AI provider. Certain Share Image exports **embed your map data** so that the map can be reconstructed by anyone who receives the image; this is described in [Section 4](#4-share-images). This tool is operated by {operator}; questions may be directed to {email}.

## 1. Definitions

The following terms are used throughout this policy with the meanings given here. They are defined once so that the sections below can stay concise.

- **"the service", "the tool", "the application", or "{app}"** means the {app} web application and the static pages that accompany it, served from the addresses described in [Section 13](#13-where-your-data-goes).
- **"we", "us", or "our"** means {operator}, the operator identified in [Section 18](#18-contact-us-and-complaints), acting as the party that publishes and maintains the tool.
- **"you" or "your"** means the person who uses the tool.
- **"local data"** means the information the application keeps within your browser on your own device, itemized in [Section 3](#3-what-we-store). It does not leave your device unless you deliberately export or transmit it.
- **"a map" or "a map project"** means the terrain, water, roads, objects, planning annotations (including text you enter), and other content you arrange in the editor.
- **"a Share Image"** means an image the tool exports from a map. An **importable** Share Image embeds enough data to reconstruct the map; a plain, non-importable export does not. Share Images are described in [Section 4](#4-share-images).
- **"the AI Agent"** means the optional feature that sends your prompts and map data to an AI provider you select, described in [Section 6](#6-ai-providers-byok).
- **"the illustration studio"** means the optional export feature that can redraw a rendered map either on your device or through an AI provider you select, as described in [Section 6](#6-ai-providers-byok).
- **"an AI provider"** means a third-party service whose API key you supply and to which the AI Agent or provider-backed illustration studio sends requests. An AI provider is not us and is not a party to this policy.
- **"personal information"** means information that identifies, relates to, or can reasonably be linked to an identifiable person, to the extent the applicable law treats it as such.
- **"a provider" (of infrastructure)** means a third party that hosts, delivers, or otherwise processes information on our behalf, such as our hosting, edge, CDN, or email providers.

## 2. Scope and What We Do Not Do

This policy explains what information {app} handles, where that information can reside, and the choices available to you. It applies to the {app} web application and the static pages that accompany it. It does not apply to any third-party service you reach through the tool, including an AI provider you select or a site you open through an external link; those are governed by their own policies (see [Section 12](#12-third-party-links)).

{app} does not operate user accounts, sign-up flows, or user profiles. It does not display advertising or set advertising cookies, does not conduct cross-site or cross-device tracking, and does not sell personal information. Because the application has no backend for map storage, the information it handles is comparatively limited. The sections below identify each category of information and where it resides.

## 3. What We Store

Almost everything the application remembers is held within your browser as **local data** and does not leave your device unless you deliberately export or transmit it. A limited further set of information can nonetheless exist off your device, chiefly because you send it somewhere or because our infrastructure logs an ordinary request. This section itemizes each category: what it contains, when it is written, and how to remove it.

### 3.1 Information Held on Your Device

This information consists of the following. Each entry states what the datum contains, the point at which it is written, and how you can remove it.

- **The autosaved map.** *What it contains:* the current map project you are editing, encoded compactly, together with the small amount of editor state needed to restore it. *When it is written:* automatically, shortly after you change the map, and only once a map has content, so a fresh, empty map never overwrites a saved one. *How to remove it:* change to another planet, clear your browser's site data, or use Settings then Local data ([Section 5](#5-local-data--clear-local-data)).
- **Your preferences.** *What it contains:* interface settings such as your chosen language and UI zoom level; AI Agent provider, model, endpoint, and oversight settings; and illustration provider, model, endpoint, direction, and custom prompt settings. API keys are covered separately below. *When it is written:* when you change the corresponding setting. *How to remove it:* clear your browser's site data or use Settings then Local data.
- **Your AI Agent session.** *What it contains:* the orders, assistant responses, tool results, plans, approval answers, and filed or cleared records used to restore the assistant panel after a reload. Provider-native response blocks and tool-result images are excluded, and reasoning is reduced to a short excerpt. *When it is written:* as the session changes. *How to remove it:* start a fresh AI Agent session, clear your browser's site data, or use Settings then Local data.
- **API keys.** *What it contains:* API keys entered for the AI Agent or illustration studio. *When it is written:* connecting the AI Agent stores its key locally; the illustration studio stores its key only when the browser key vault can seal it and otherwise keeps it in memory for the current session. Where supported, keys are sealed at rest in an IndexedDB key vault. The AI Agent uses light obfuscation as a fallback when that vault is unavailable; the illustration studio does not write its key in that case. *How to remove it:* remove an AI Agent key in its settings, clear your browser's site data, or use Settings then Local data, which also clears the key vault. The protections and limits are described in [Sections 7](#7-api-keys) and [8](#8-security-measures).

Clearing your browser's site data, or using Settings then Local data, removes this information, as described in [Section 5](#5-local-data--clear-local-data).

### 3.2 Information That Can Exist Outside Your Device

Although map projects are not stored on a project-operated server, a limited set of information can nonetheless exist off your device. Each entry again states what it is, when it arises, and, where you can, how to limit or remove it.

- **Hosting, CDN, and security logs.** *What they contain:* ordinary request metadata such as an IP address, the resource requested, a timestamp, and a user-agent string, used to serve the site and to defend it against abuse. *When they arise:* whenever your browser fetches the site's files. *How to limit them:* they are created by our hosting and edge providers and governed by their policies and retention ([Sections 13](#13-where-your-data-goes) and [14](#14-data-retention)); the project does not operate a separate application log store.
- **Aggregate, cookieless analytics.** *What they contain:* if our hosting or CDN platform provides them, aggregate traffic figures with no advertising cookie and no cross-site identifier, as described in [Section 9](#9-analytics--consent). *When they arise:* as part of that platform's delivery service.
- **Emails and reports.** *What they contain:* whatever you write to us, including any detail you choose to include. *When they arise:* when you send them. *How to remove them:* ask us, subject to [Section 16](#16-your-rights).
- **AI Agent requests.** *What they contain:* your prompts, map data or snapshots, and the results of tools the AI Agent runs. *When they arise:* when you actively invoke the AI Agent, apart from the key-validation and model-list requests described in [Section 6](#6-ai-providers-byok), which contain no map data or prompt. *How to limit them:* do not connect or use the AI Agent, or consult the provider about deletion; the request is governed by the provider, not by us.
- **Provider-backed illustration requests.** *What they contain:* a rendered image of the current map, style instructions, a machine-generated scene summary, and, where supported, a bundled style sample or an earlier illustration of the same map that you chose to keep. *When they arise:* when you request a provider-backed illustration, apart from model-list or connection checks after you enter a key. On-device styles make no provider request. *How to limit them:* use an on-device style or do not connect the illustration studio; for records already sent, consult the provider about deletion.
- **Images or files that you intentionally publish** to third-party services, for example when you share an exported image. *When they arise:* when you publish them. *How to remove them:* through the service you published to, if it allows removal.
- **Data embedded in importable Share Images**, including the map and planning annotations, as described in [Section 4](#4-share-images).

## 4. Share Images

An importable Share Image carries a visible PetitGlyph strip. That strip contains the terrain, water, roads, objects, and any planning annotations, including annotation text and the layer's visibility and lock state. It can also contain an optional generation recipe, the export title and timestamp, application and format versions, and indicators of whether AI or procedural generation contributed to the map. Anyone who receives the image can use this data to reconstruct the corresponding map in {app}.

The **Show notes** control determines whether planning annotations are drawn over the exported map. It does not remove them from an importable PetitGlyph. To export only the rendered picture, without a recoverable PetitGlyph payload, turn off Importability or choose a plain, non-importable export. Clearing ordinary file metadata does not remove a PetitGlyph because its data is encoded in the visible pixels.

Accordingly, you should treat an importable Share Image as you would treat the underlying map file, and share it only with people whom you are content to allow to open your map. The embedding is a technical property of the file and is not processing we perform on a server: the image is produced in your browser, and what it discloses is determined by whom you send it to.

## 5. Local Data & "Clear Local Data"

The Settings then Local data command deletes the {app} data stored in the current browser, including the autosaved map, your preferences, the AI Agent session, and any stored API keys and browser-vault key. The operation runs entirely on your device.

This command **does not delete** the following, which are outside our control or already beyond the current browser:

- files that you have already downloaded or exported;
- images that you have already shared or published;
- browser or device backups, including cloud synchronization of browser data;
- hosting, CDN, or security logs;
- emails or reports that you have already sent to us;
- records held by an AI provider that you have used through the AI Agent or illustration studio;
- copies of your maps or images that any other person has made.

Because the command clears only the current browser on the current device, you should run it on each browser and device where you have used the tool if your aim is to leave no local data behind.

## 6. AI Providers (BYOK)

The AI Agent and the provider-backed part of the illustration studio are optional features offered on a "bring your own key" basis. You supply an API key, and requests are sent directly from your browser to the provider you select. This policy describes what the application transmits; the provider's handling and retention of those requests are governed by **your agreement with that provider and by that provider's own policies**. Review them before use.

Data use can differ by provider and service tier. Some free or unpaid API services may use inputs and outputs to improve their products or allow human review, while paid or enterprise services may apply different rules. The application cannot determine from a key which service tier or contract governs it.

### AI Agent

When you actively invoke the AI Agent, it may send your prompts, map data or snapshots of the current map, and tool results to the selected provider. The connection is user-triggered: **no request carrying your map data or prompts occurs until you actively invoke the AI Agent.** When you enter or validate a key, or open the AI Agent with a stored key, the application may contact the selected provider or candidate providers to validate the key and list available models. Those connection requests authenticate with the key but carry no map data and no prompts.

The AI Agent currently offers {agentProviderCount} connection choices:

{providers}

### Illustration Studio

When you request a provider-backed illustration, the studio may send the data described in [Section 3.2](#32-information-that-can-exist-outside-your-device) to the selected provider. Entering a key can also trigger model-list and connection checks that authenticate with the key but carry no map image or style prompt. No illustration data is sent until you request a provider-backed illustration. Procedural and on-device model styles run locally and make no request to an AI provider.

The provider-backed illustration studio currently offers {illustrationProviderCount} connection choices:

{illustrationProviders}

## 7. API Keys

An AI Agent key is stored locally when you connect it so that you need not re-enter it. An illustration-studio key is stored only when the browser vault can seal it; otherwise it remains in memory for the current session and is not written to browser storage. Local protection **cannot** defend against a compromised browser, extension, script, or device: code executing in your browser could read a stored key or capture one as you enter it.

Where your browser supports it, stored keys are sealed at rest under a non-extractable key held within the browser. If the vault is unavailable, the AI Agent's stored key is only lightly obfuscated, while the illustration studio keeps its key in session memory instead of writing it. Keys are sent only to the provider you select or, while an AI Agent key's provider is being identified, to candidate providers. Named providers use HTTPS; a custom loopback endpoint can use HTTP if you configure it. Keys are never sent to a project-operated server. On a shared or public device, use Settings then Local data when you have finished.

## 8. Security Measures

The service uses the following technical measures. The [technical threat model]({repo}/blob/main/docs/THREAT_MODEL.md) describes their scope and limitations; the [Security Policy](/security) explains how to report a vulnerability.

- **Encrypted transport.** The site and named-provider requests use HTTPS; the production edge sets HTTP Strict Transport Security. A custom loopback endpoint can use HTTP only when you configure one explicitly.
- **A strict Content Security Policy.** The application keeps scripts to the site's own origin and limits network connections to the site's functions, provider APIs, HTTPS custom endpoints, and local gateways.
- **At-rest sealing of API keys where supported.** As described in [Section 7](#7-api-keys), stored keys use a non-extractable browser key where available, and provider error text shown or stored by the application is scrubbed of key-shaped tokens.
- **No map-storage backend.** No project-operated application backend receives or stores your map projects.

These controls cannot protect data on a device that is itself compromised. Malware, a hostile browser extension, or another person with access to the device may read local data or capture keys as they are entered. On a shared or public device, clear local data when you finish.

## 9. Analytics & Consent

The application does not implement advertising analytics, set advertising cookies, or perform cross-site tracking. Our hosting or CDN platform may provide aggregate, cookieless traffic figures as part of site delivery and abuse protection.

Should our analytics implementation change, the consent experience **will be reassessed** and this policy updated accordingly. We make no categorical claim that consent is or is not required in any particular jurisdiction.

## 10. Do Not Track & Global Privacy Control

Some browsers can send a "Do Not Track" (DNT) header or a Global Privacy Control (GPC) signal. {app} performs no cross-site or cross-device tracking, sets no advertising cookies, does not sell personal information, and does not share it for cross-context behavioural advertising, so these signals do not change its current handling. If our practices change so that either signal becomes relevant, we will update this section and describe our response.

## 11. Automated Decision-Making

We do not use automated processing to make decisions that produce legal or similarly significant effects about you. We build no profiles, assign no scores, and run no automated eligibility, pricing, or ranking decisions concerning you.

The AI Agent and illustration studio generate creative content at your direction. Their output is material that you request and review, not a decision we make about you, and it has no effect on any right, access, or treatment you receive. An AI provider's processing of a request is governed by that provider ([Section 6](#6-ai-providers-byok)).

## 12. Third-Party Links

The tool and these pages link to third-party services, including the team's Bilibili spaces, the project's source repository on GitHub, and the consoles or documentation of the AI providers you may use. When you follow such a link or send a request to such a service, you leave the parts of the service we control and enter one governed by that third party's own terms and privacy policy. We do not control, and are not responsible for, the content or the data practices of those services. Review their policies before you rely on them; in particular, an AI provider's handling of what you send it is governed by [Section 6](#6-ai-providers-byok) and by your agreement with that provider.

## 13. Where Your Data Goes

The following locations are disclosed separately because they are distinct: the location of the legal operator; the location at which the site is hosted; the location at which edge and CDN processing occurs; the AI-provider destinations that you select; and your own location.

- **The site's files.** {app} is served as static files from {hostNetwork}. The project operates no application backend that receives, processes, or stores your map projects.
- **Edge delivery.** {edgeDelivery} This edge processing serves the files and protects the service; it does not receive the map projects that remain in your browser.
- **Correspondence.** Email that you send to us is hosted on Microsoft Outlook infrastructure and handled under Microsoft's terms.
- **AI-provider requests.** When you use the AI Agent or request a provider-backed illustration, requests go directly from your browser to the provider you select, are processed in that provider's own regions, and are governed by that provider's terms, as described in [Section 6](#6-ai-providers-byok).
- **Your own location.** Your requests originate from wherever you use {app}.

Edge providers and the AI provider you select may operate in more than one country. Hosting request metadata and any AI request you initiate may therefore be processed outside the country in which you live. Your map project remains on your device unless you choose an action that transmits or publishes it as described in this policy.

This service is operated by {operator}.

## 14. Data Retention

We retain information under our control only for as long as necessary for its purpose. The table below also identifies information held by your browser or by a third-party provider.

| Category | Held by | Retention |
| --- | --- | --- |
| Local data (autosaved map, preferences, AI Agent session, API keys) | Your browser on your device | Until you clear it or, for a session-only key, until the session ends; it stays on your device except for content you explicitly transmit or export as described in this policy |
| Contact email threads | Project mailbox | Up to 24 months after the matter is resolved |
| Security reports | Project mailbox | Life of the affected code plus 12 months |
| Aggregate, anonymized analytics, if provided | Hosting or CDN provider | Per that provider's policy; only irreversibly aggregated data may be kept indefinitely |
| Hosting, CDN, and security logs | Hosting or CDN provider | Per that provider's policy |
| AI-provider request records | Selected AI provider | Per that provider's policy and your agreement |

Retention of information held by our hosting, CDN, email, and AI providers is governed by their respective policies.

We describe information as retained **indefinitely** only where it has been truly aggregated and irreversibly anonymized. All other information is subject to a defined review or deletion period, which is twenty-four months by default unless our schedule specifies a different period. In particular, contact email threads are retained for up to twenty-four months after the relevant matter is resolved, and security reports are retained for the life of the affected code plus twelve months. The removal of direct identifiers alone does not render information non-identifying, and we do not treat it as such.

## 15. Children

{app} is a general-audience creative tool and is not directed to young children. We do not knowingly collect personal information from children; there are no accounts, and maps remain on your device, so we build no profiles.

The tool has no sign-up flow or map-storage backend and does not ask for a user's age. We do not knowingly direct the tool at, or knowingly collect personal information from, a child below the age of digital consent in the place where they live. If you are a parent or guardian and believe that a child has sent us personal information, for example by email, please contact us using [Section 18](#18-contact-us-and-complaints); we will delete it promptly once we can identify it, and we will confirm the deletion to you. This commitment is in addition to any right described in [Section 16](#16-your-rights).

Provider-backed AI features have separate eligibility rules, including age and account restrictions. A child or minor must not connect an AI provider unless that provider's terms permit the use; a parent or guardian's consent to use {app} does not override the provider's requirements.

## 16. Your Rights

Depending on where you live and which laws apply, you may have rights over your personal information. The applicable laws may include the GDPR, China's PIPL, or United States state privacy laws. Those rights may include:

- obtaining information about, accessing, correcting, or deleting personal information;
- objecting to or restricting certain processing; and
- where it applies, data portability.

Please contact us, and we will respond to the extent that the request applies to information we actually hold.

We are willing to honor requests of this kind on a voluntary basis where they apply, without asserting that any particular law necessarily governs us. Exercising a right is free of charge and will not lead to any disadvantage in your use of {app}. We may need to confirm that a request genuinely comes from you before we act on it, and we will limit that confirmation to what is necessary.

## 17. Changes to This Policy

We may update this policy from time to time. When we do so, we revise the effective date and policy version shown at the top of this page. Each version is identified by its version number together with that effective date, so it is always determinable which version applied at a given time.

We will identify material changes. The revised policy applies from its stated effective date; where applicable law requires advance notice or consent, we will provide it. Published versions remain available in the [project repository]({repo}) history.

## 18. Contact Us and Complaints

Questions concerning this policy, and privacy requests such as those described in [Section 16](#16-your-rights), may be directed to {email}. We aim to respond within a reasonable time; the [Contact](/contact) page sets out the response expectations per channel.

If you believe we have handled your personal information improperly, we would like the chance to put it right, so please raise it with us first. Where the law of your country or region provides one, you also have the right to complain to your local data-protection or privacy supervisory authority; contacting us first does not remove that right.

This policy is issued by {operator}. The canonical version of this page is published at [{origin}]({origin}).
