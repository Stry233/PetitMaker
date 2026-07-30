# Privacy Policy

## At a Glance

This summary is provided for convenience and does not replace the full policy set out in the numbered sections below. {app} is a map-planning tool that runs entirely in your web browser. There are no user accounts, and your map projects are **not stored on our servers by default**; they reside in your browser and in the files you choose to export. We display no advertising, set no advertising cookies, and perform no cross-site or cross-device tracking. The AI Agent is optional and operates on an API key you supply ("bring your own key"), which is stored on your device. Certain Share Image exports **embed your map data** so that the map can be reconstructed by anyone who receives the image; this is described in [Section 4](#4-share-images). This tool is operated by {operator}; questions may be directed to {email}.

## 1. Definitions

The following terms are used throughout this policy with the meanings given here. They are defined once so that the sections below can stay concise.

- **"the service", "the tool", "the application", or "{app}"** means the {app} web application and the static pages that accompany it, served from the addresses described in [Section 13](#13-where-your-data-goes).
- **"we", "us", or "our"** means {operator}, the operator identified in [Section 18](#18-contact-us-and-complaints), acting as the party that publishes and maintains the tool.
- **"you" or "your"** means the person who uses the tool.
- **"local data"** means the information the application keeps within your browser on your own device, itemized in [Section 3](#3-what-we-store). It does not leave your device unless you deliberately export or transmit it.
- **"a map" or "a map project"** means the terrain, water, roads, objects, and other content you arrange in the editor.
- **"a Share Image"** means an image the tool exports from a map. An **importable** Share Image embeds enough data to reconstruct the map; a plain, non-importable export does not. Share Images are described in [Section 4](#4-share-images).
- **"the AI Agent"** means the optional feature that sends your prompts and map data to an AI provider you select, described in [Section 6](#6-ai-providers-byok).
- **"an AI provider"** means the third-party service whose API key you supply and to which the AI Agent sends requests. A provider is not us and is not a party to this policy.
- **"personal information"** means information that identifies, relates to, or can reasonably be linked to an identifiable person, to the extent the applicable law treats it as such.
- **"a provider" (of infrastructure)** means a third party that hosts, delivers, or otherwise processes information on our behalf, such as our hosting, edge, CDN, or email providers.

## 2. Scope and What We Do Not Do

This policy explains what information {app} handles, where that information can reside, and the choices available to you. It applies to the {app} web application and the static pages that accompany it. It does not apply to any third-party service you reach through the tool, including an AI provider you select or a site you open through an external link; those are governed by their own policies (see [Section 12](#12-third-party-links)).

{app} does not operate user accounts, sign-up flows, or user profiles. It does not display advertising or set advertising cookies, does not conduct cross-site or cross-device tracking, and does not sell personal information. Because the application has no backend for map storage, the information it handles is comparatively limited. The sections below identify each category of information and where it resides.

## 3. What We Store

Almost everything the application remembers is held within your browser as **local data** and does not leave your device unless you deliberately export or transmit it. A limited further set of information can nonetheless exist off your device, chiefly because you send it somewhere or because our infrastructure logs an ordinary request. This section itemizes each category: what it contains, when it is written, and how to remove it.

### 3.1 Information Held on Your Device

This information consists of the following. Each entry states what the datum contains, the point at which it is written, and how you can remove it.

- **The autosaved map.** *What it contains:* the current map project you are editing, encoded compactly, together with the small amount of editor state needed to restore it. *When it is written:* automatically, shortly after you change the map, and only once a map has content, so a fresh, empty map never overwrites a saved one. *How to remove it:* start a new project, clear your browser's site data, or use Settings then Local data ([Section 5](#5-local-data--clear-local-data)).
- **Your preferences.** *What it contains:* interface settings such as your chosen language, the UI zoom level, and the settings of the AI Agent (but not the API key itself, covered below). *When it is written:* when you change the corresponding setting. *How to remove it:* clear your browser's site data or use Settings then Local data.
- **API keys.** *What it contains:* the API key or keys you enter for the AI Agent, and the endpoint address for a custom provider. *When it is written:* only if you use the AI Agent and choose to have a key retained, so that you need not re-enter it. Where the browser supports it, a key is sealed at rest in a browser-only IndexedDB key vault; the protections and limits of this are described in [Sections 7](#7-api-keys) and [8](#8-security-measures). *How to remove it:* remove the key in the AI Agent's settings, or use Settings then Local data, which also clears the key vault.

Clearing your browser's site data, or using Settings then Local data, removes this information, as described in [Section 5](#5-local-data--clear-local-data).

### 3.2 Information That Can Exist Outside Your Device

Although map projects are not stored on our servers by default, a limited set of information can nonetheless exist off your device. Each entry again states what it is, when it arises, and, where you can, how to limit or remove it.

- **Hosting, CDN, and security logs.** *What they contain:* ordinary request metadata such as an IP address, the resource requested, a timestamp, and a user-agent string, used to serve the site and to defend it against abuse. *When they arise:* whenever your browser fetches the site's files. *How to limit them:* they are created by our hosting and edge providers and governed by their policies and retention ([Sections 13](#13-where-your-data-goes) and [14](#14-data-retention)); we operate no backend that adds to them.
- **Aggregate, cookieless analytics.** *What they contain:* aggregate traffic figures with no advertising cookie and no cross-site identifier, as described in [Section 9](#9-analytics--consent). *When they arise:* as part of ordinary delivery by our hosting or CDN platform.
- **Emails and reports.** *What they contain:* whatever you write to us, including any detail you choose to include. *When they arise:* when you send them. *How to remove them:* ask us, subject to [Section 16](#16-your-rights).
- **Requests sent to an AI provider.** *What they contain:* your prompts, map data or snapshots, and tool results, as described in [Section 6](#6-ai-providers-byok). *When they arise:* only when you actively invoke the AI Agent. *How to limit them:* do not use the AI Agent, or consult the provider about deletion; the request is governed by the provider, not by us.
- **Images or files that you intentionally publish** to third-party services, for example when you share an exported image. *When they arise:* when you publish them. *How to remove them:* through the service you published to, if it allows removal.
- **Map data embedded in exported Share Images**, as described in [Section 4](#4-share-images).

## 4. Share Images

When you export an importable Share Image, the resulting image may contain embedded map data, a visible restore strip, or both. Anyone who receives such an image may be able to reconstruct the corresponding map in {app}. Choosing a plain, non-importable export changes what recovery data is included in the file. You should be aware that removing visible elements or ordinary metadata may not remove every embedded carrier of that data.

Accordingly, you should treat an importable Share Image as you would treat the underlying map file, and share it only with people whom you are content to allow to open your map. The embedding is a technical property of the file and is not processing we perform on a server: the image is produced in your browser, and what it discloses is determined by whom you send it to.

## 5. Local Data & "Clear Local Data"

The Settings then Local data command deletes the {app} data stored in the current browser, namely the autosaved map, your preferences, and any stored API keys, including the browser key vault. The operation runs entirely on your device.

This command **does not delete** the following, which are outside our control or already beyond the current browser:

- files that you have already downloaded or exported;
- images that you have already shared or published;
- browser or device backups, including cloud synchronization of browser data;
- hosting, CDN, or security logs;
- emails or reports that you have already sent to us;
- records held by an AI provider that you have used;
- copies of your maps or images that any other person has made.

Because the command clears only the current browser on the current device, you should run it on each browser and device where you have used the tool if your aim is to leave no local data behind.

## 6. AI Providers (BYOK)

The AI Agent is an optional feature offered on a "bring your own key" basis: you supply an API key for a provider of your choice, and requests are sent directly from your browser to that provider.

When you actively invoke the AI Agent, information may be transmitted to the provider you have selected. That information can include your prompts, map data or snapshots of the current map, and the results of tools the AI Agent runs. This processing is governed by **your own agreement with that provider and by that provider's retention rules**, and not by this policy; you should review the provider's terms and privacy policy before use.

The AI Agent transmits nothing on its own initiative: **no request carrying your map data or prompts occurs until you actively trigger it.** One narrow exception applies. When you enter or validate an API key, or open the AI Agent while a stored key is present, the application contacts your selected provider, or, where a key's provider is ambiguous, the candidate providers, in order to validate the key and list the available models. That request authenticates using your API key but carries no map data and no prompts. Apart from this validation step, nothing is transmitted to any provider unless you actively use the AI Agent.

The providers you may select are:

{providers}

## 7. API Keys

If you use the AI Agent, your API key may be stored locally on your device so that you need not re-enter it. Local protection **cannot** defend against a compromised browser, extension, script, or device: anything able to execute code in your browser could read a stored key. This limitation is inherent to any client-side application.

Where your browser supports it, keys are sealed at rest under a key held only within your browser; where it does not, keys are only lightly obfuscated. Neither measure is a substitute for the limitation described above. Keys are transmitted only to the provider you have selected, or, while a provider is being identified, to the candidate providers, over an encrypted (HTTPS) connection, and are never transmitted to us. On a shared or public device, use Settings then Local data when you have finished.

## 8. Security Measures

We apply reasonable, honest technical measures to the parts of the service that are ours to control, and we describe their limits plainly rather than overstate them. The complete technical account is published in our [Security Policy](/security); the measures most relevant to your data are:

- **Encrypted transport.** The site and every request it makes are served over HTTPS; the production edge sets HTTP Strict Transport Security so that connections stay encrypted.
- **A strict Content Security Policy.** The application ships a strict CSP that keeps scripts to the site's own origin and restricts the destinations the page may contact to the site itself and the allow-listed AI providers. This reduces the surface for injected or third-party code.
- **At-rest sealing of API keys where supported.** As described in [Section 7](#7-api-keys), a stored API key is sealed at rest under a non-extractable browser key where the browser provides one, and error text shown or stored in the AI Agent is scrubbed of key-shaped tokens.
- **No backend for your maps.** Because we run no server that receives your map projects, there is no central store of them for an attacker to reach; the structural choice is itself a protection.

These measures raise the bar; they cannot make any client-side application immune. **No security measure protects data on a device that is itself compromised** by malware, a hostile browser extension, or another person with access to it. You remain the last line of defense for the device you use, and on a shared or public device you should clear local data when you finish.

## 9. Analytics & Consent

The product currently sets no advertising cookies and performs no cross-site tracking. Aggregate, cookieless analytics may be collected by our hosting or CDN platform in order to understand overall traffic and to protect the service against abuse.

Should our analytics implementation change, the consent experience **will be reassessed** and this policy updated accordingly. We make no categorical claim that consent is or is not required in any particular jurisdiction.

## 10. Do Not Track & Global Privacy Control

Some browsers can send a "Do Not Track" (DNT) header or a Global Privacy Control (GPC) signal. These signals are designed to opt a person out of tracking and out of the sale or sharing of personal information. Because {app} performs no cross-site or cross-device tracking, sets no advertising cookies, and does not sell or share personal information for advertising, there is nothing for such a signal to switch off: the behavior a DNT or GPC signal asks for is already our default for every visitor. We therefore do not need to change our handling in response to one, and we state this precisely rather than claim to "honor" a control over activities we do not carry out. If our practices ever change so that a signal would become meaningful, we will update this section and describe how we respond.

## 11. Automated Decision-Making

We do not use automated processing to make decisions that produce legal or similarly significant effects about you. We build no profiles, assign no scores, and run no automated eligibility, pricing, or ranking decisions concerning you.

The AI Agent, when you choose to use it, generates map content and suggestions at your direction. Its output is assistance that you request and review; it is a creative aid, not a decision that we make about you, and it has no effect on any right, access, or treatment you receive. The provider's own processing of the request you send is governed by that provider ([Section 6](#6-ai-providers-byok)).

## 12. Third-Party Links

The tool and these pages link to third-party services, including the team's Bilibili spaces, the project's source repository on GitHub, and the consoles or documentation of the AI providers you may use. When you follow such a link or send a request to such a service, you leave the parts of the service we control and enter one governed by that third party's own terms and privacy policy. We do not control, and are not responsible for, the content or the data practices of those services. Review their policies before you rely on them; in particular, an AI provider's handling of what you send it is governed by [Section 6](#6-ai-providers-byok) and by your agreement with that provider.

## 13. Where Your Data Goes

The following locations are disclosed separately because they are distinct: the location of the legal operator; the location at which the site is hosted; the location at which edge and CDN processing occurs; the AI-provider destinations that you select; and your own location.

- **The site's files.** {app} is served as static files from Alibaba Cloud Object Storage Service (OSS). We operate no servers of our own: there is no application backend that receives, processes, or stores your map projects.
- **Edge delivery.** Those static files are delivered through Alibaba Cloud ESA (Edge Security Acceleration). Its edge nodes may process your requests in or near your own region, which for many users includes mainland China. This edge processing serves the files and protects the service; it does not receive the map projects that remain in your browser.
- **Correspondence.** Email that you send to us is hosted on Microsoft Outlook infrastructure and handled under Microsoft's terms.
- **AI-provider requests.** When you use the AI Agent, requests go directly from your browser to the provider you select, are processed in that provider's own regions, and are governed by that provider's terms, as described in [Section 6](#6-ai-providers-byok).
- **Your own location.** Your requests originate from wherever you use {app}.

Edge delivery, and the AI providers you may choose, can operate in more than one country. As a result, information handled on our behalf (chiefly ordinary request metadata such as an IP address and the resources requested) may be processed outside the country in which you live. We limit what crosses a border by keeping your map projects on your device and operating no backend of our own.

This service is operated by {operator}.

## 14. Data Retention

For information under our control, we retain it only for as long as is necessary for the purpose for which it was collected. The configured periods are recorded in our internal retention schedule and will be finalized before launch. The table below summarizes the position by category; the prose beneath it states the principles the table applies.

| Category | Controller | Retention |
| --- | --- | --- |
| Local data (autosaved map, preferences, API keys) | You, on your device | Until you clear it; never sent to us |
| Contact email threads | Us | Up to 24 months after the matter is resolved |
| Security reports | Us | Life of the affected code plus 12 months |
| Aggregate, anonymized analytics | Our hosting / CDN | May be kept indefinitely only because it is irreversibly aggregated |
| Hosting, CDN, and security logs | Provider-controlled | Per that provider's policy |
| AI-provider request records | Provider-controlled | Per that provider's policy and your agreement |

Retention of provider-controlled information, namely information held by our hosting, CDN, email, and AI providers, is governed by those providers. We do not invent retention figures on their behalf; you should consult their respective policies.

We describe information as retained **indefinitely** only where it has been truly aggregated and irreversibly anonymized. All other information is subject to a defined review or deletion period, which is twenty-four months by default unless our schedule specifies a different period. In particular, contact email threads are retained for up to twenty-four months after the relevant matter is resolved, and security reports are retained for the life of the affected code plus twelve months. The removal of direct identifiers alone does not render information non-identifying, and we do not treat it as such.

## 15. Children

{app} is a general-audience creative tool and is not directed to young children. We do not knowingly collect personal information from children; there are no accounts, and maps remain on your device, so we build no profiles.

Because the tool has no sign-up and no backend, it asks for no age and holds no record from which a child could be identified. We do not knowingly direct the tool at, or knowingly collect personal information from, a child below the age of digital consent in the place where they live. If you are a parent or guardian and believe that a child has sent us personal information, for example by email, please contact us using [Section 18](#18-contact-us-and-complaints); we will delete it promptly once we can identify it, and we will confirm the deletion to you. This commitment is in addition to any right described in [Section 16](#16-your-rights).

## 16. Your Rights

Depending on where you live and which laws apply, you may have rights over your personal information. The applicable laws may include the GDPR, China's PIPL, or United States state privacy laws. Those rights may include:

- obtaining information about, accessing, correcting, or deleting personal information;
- objecting to or restricting certain processing; and
- where it applies, data portability.

Because we hold so little that identifies you, many such requests will be short to resolve. Please contact us, and we will respond to the extent that the request applies to information we actually hold.

We are willing to honor requests of this kind on a voluntary basis where they apply, without asserting that any particular law necessarily governs us. Exercising a right is free of charge and will not lead to any disadvantage in your use of {app}. We may need to confirm that a request genuinely comes from you before we act on it, and we will limit that confirmation to what is necessary.

## 17. Changes to This Policy

We may update this policy from time to time. When we do so, we revise the effective date and policy version shown at the top of this page. Each version is identified by its version number together with that effective date, so it is always determinable which version applied at a given time.

We will identify material changes, and continued use of {app} following an update constitutes your acceptance of the revised policy. Once the project's repository is public, prior versions of this policy remain available through the repository's history, so a superseded version can be retrieved and compared. We keep this archive rather than silently replace the text.

## 18. Contact Us and Complaints

Questions concerning this policy, and privacy requests such as those described in [Section 16](#16-your-rights), may be directed to {email}. We aim to respond within a reasonable time; the [Contact](/contact) page sets out the response expectations per channel.

If you believe we have handled your personal information improperly, we would like the chance to put it right, so please raise it with us first. Where the law of your country or region provides one, you also have the right to complain to your local data-protection or privacy supervisory authority; contacting us first does not remove that right.

This policy is issued by {operator}. The canonical version of this page is published at [{origin}]({origin}).
