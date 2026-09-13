# Privacy Policy

## Overview

{app}, maintained by {operator}, is a browser-based map-planning tool. Maps are edited and saved in the current browser; you export and keep files for long-term storage.

Visiting the site still generates ordinary network requests. Online AI features send relevant instructions, map information or images to the service you choose. Export content checks and local illustration processing run on your device without uploading text or maps for that purpose. The same on-device check screens Agent task text and custom illustration style text before a request is sent, and a refused request is not sent.

This policy explains how each category of information is used, where it is stored and how it can be deleted. Service-use rules and content responsibilities are in the [Terms of Use](/terms). Privacy questions can be sent to {email}.

## 1. Scope

This policy applies to the {app} web application and its accompanying pages. “We” means {operator}, the tool's operator. “Local data” means maps, settings, conversations, keys and other information the application stores in the current browser.

Third-party AI services, GitHub, Bilibili, sponsorship platforms and other external websites have their own data policies. This policy explains when the tool contacts them; it does not replace their policies.

## 2. How Information Is Used

Browser storage supports editing and recovery. Hosting services deliver the application and its resources. We also handle inquiries and reports you choose to send. Optional online AI requests are initiated by you and sent directly from the browser to the relevant service.

The tool's purposes for processing personal information are limited to providing the features you select, delivering site resources, maintaining service security and handling inquiries or reports. Maps and input are processed locally or sent through your actions to the recipients described here. Using feedback material for model training requires a separate explanation of that purpose and the applicable authorization.

Where applicable law requires a processing basis, we rely on what is necessary to provide a requested service, your valid consent, a legal obligation or another legally permitted basis. We will provide separate notice or obtain consent where required. Using the tool is not blanket consent to purposes that have not been explained.

## 3. Information Stored in Your Browser

| Information | Purpose and when it is saved |
| --- | --- |
| Maps and recovery data | Saves the current map and necessary recovery state after edits; may include planning annotations, map notes, provenance, camera position and some undo history |
| Interface and editing preferences | Remembers language, scale, display, hints, shortcuts and other settings when the relevant options change |
| Export settings | Remembers the preset, size, display options and footer template, including custom text in that template. Image titles and descriptions are not stored as export preferences; JSON notes may be saved with the map |
| Agent connection settings | Remembers the provider, model, endpoint, reasoning effort and supervision mode; keys are handled under Section 7 |
| Agent conversation | Saves task instructions, replies, tool results, plans, answers and necessary record state to restore the conversation when the panel is reopened |
| Illustration settings | Remembers the image service, model, endpoint, style direction and custom style instructions; keys are handled under Section 7 |

The Agent saves a structured record for restoring the interface, rather than complete raw provider responses or images from tool results. Only short excerpts of reasoning are retained. Clearing a task record removes its conversation content and affected summaries; later requests use the cleaned conversation. This does not undo map edits or delete content a provider has already received.

Generated illustration takes remain in the current session rather than being saved automatically as long-term works. Export them yourself if you want to keep them.

Local data normally remains until you clear it or the browser removes it. Capacity limits, private browsing and device settings can affect storage; storage cannot be guaranteed indefinitely. Different browsers, and the mainland China and international sites, each have separate site storage without automatic synchronization.

## 4. Exported Files and Content Checks

### 4.1 Text and Map Checks

The application checks added titles, descriptions and footer text on your device before they appear in an image preview or export. When JSON notes are enabled, their title, description and author are checked too. Website-link detection is also local and does not visit the links you enter.

Before the first image preview, and when you click Export for JSON, the application also checks renderings of the current map and its planning annotations. Turning off Planning annotations for JSON also excludes annotations from those checks. A selected illustration take is included in image-export checks. The checks can miss content or flag it incorrectly, and an unfinished check is reported in the interface. They do not certify every part of a file or its legality.

The checking code, vocabulary data, image models, OCR data and runtime components come from the current site. Your browser may need to load and cache them first. Checking resources are not fetched from third-party model sites, and text, images and recognized text are not submitted to a remote moderation service.

The checking feature does not separately persist submitted text, map images, recognized text or verdicts. Some temporary data remains briefly in memory to support continued editing; closing the panel or cancelling the relevant task ends its check. Map autosave, JSON notes and footer preferences still follow Section 3. Model and program resources may remain in the browser cache.

### 4.2 JSON Saves

JSON files contain map data. The Planning annotations option is enabled by default; turning it off excludes annotation data from the file. Depending on your selections, these files may also contain a title, description, author, generation information, provenance, undo history, and camera and layer state. Undo history can retain content that has been removed or changed in the current view.

Turning off Notes omits only the title, description and author in that section. The Planning annotations option controls annotations separately. Choose the additional sections for your intended use before sharing.

### 4.3 Importable Images

When Importability is enabled and code generation succeeds, the image includes a PetitGlyph ribbon containing terrain, water, roads, objects and planning annotations, including zones, tags, routes and the annotation layer's visibility and lock state. It may also contain generation parameters, export time, format versions and summary information about AI or procedural generation.

Newly exported codes no longer store the image title; older images may still contain that field. Anyone with a usable code can restore the map data it contains.

**Turning off Show notes does not remove annotations from the code.** To share just the picture, choose Plain image or turn off Importability. Plain images still display their visible text and designs. Map codes are stored in pixels, so removing ordinary file metadata does not remove them.

Export without added text omits the current image title and description and restores the default footer. It does not remove annotations or importable map data.

The tool generates exports locally without automatically publishing them to a project server. You keep or send the files yourself; recipients and platforms may retain or forward them.

## 5. Clearing Local Data

Clear and restart in Settings clears application storage for the current site in the current browser, including autosaves, preferences, Agent conversations, saved API keys and the key vault, then reloads the page.

This does not clear downloaded files, published works, copies on other devices or browsers, browsing history, resource caches, device backups, emails we have received or requests already received by third parties. Browser history and caches can be managed through the browser's own settings.

Storage for the mainland China and international sites is separate. Clearing one does not clear the other. Browser restrictions may prevent complete cleanup; if so, use the browser's site-data controls.

## 6. Online AI and Model Information

### 6.1 Connection and Key Validation

Entering a key, validating a connection or managing models can send authentication and model-list requests to providers. To identify the provider automatically, the application may try to validate the key with candidate providers that use a matching key format. You explicitly configure a custom endpoint. Connection requests use the key but do not contain your map or creative instructions.

Providers may log authentication and connection requests. Before connecting, review the endpoint, account eligibility and service terms. For custom services, check who operates the endpoint and what it receives.

### 6.2 Agent Tasks

Before a task starts, its text passes the on-device content check described in Section 11; a refused task is answered locally and not sent. After you submit or resume a task, the selected provider may receive task instructions, conversation context, map text, tool results and rendered maps needed by models that support image input. Continuing tasks can send multiple requests; additional instructions you provide can enter later requests.

Annotations and other information included in map data, summaries or images are sent with them. Closing the panel, stopping a task or clearing local history cannot recall data already sent.

The Agent currently offers {agentProviderCount} connection options. The available services are listed below:

{providers}

### 6.3 Illustration Generation

Procedural and on-device model styles run locally without generation requests to an image provider. Custom style text passes the on-device content check described in Section 11 before an online request is made. Online illustration may send a rendered map, style instructions, a scene summary and any bundled style sample or existing take of the same map required by the selected workflow. Agent conversations and browser-storage contents are not sent for online illustration.

Online illustration currently offers {illustrationProviderCount} connection options:

{illustrationProviders}

### 6.4 Model Capability Directory

Connection setup and model management retrieve public model-capability information from Models.dev. This request contains no API key, map, instructions or cookies, but the recipient still receives ordinary request information such as an IP address. The application temporarily retains the directory to reduce repeat requests.

### 6.5 Data Rules for Providers

How a provider retains request content, reviews it or uses it for product improvement or model training depends on the service, paid tier, account settings and your agreement with that provider. The tool cannot establish these conditions from a key alone or guarantee deletion or confidentiality on the provider's behalf. Review the relevant policy before use, and contact the actual recipient to access or delete content already sent.

## 7. API-Key Storage and Protection

An Agent key is stored locally after a successful connection. When the browser key vault is available, the application uses local encryption. If the vault is unavailable, the Agent may store a lightly obfuscated key, which is not encryption.

The illustration studio saves encrypted keys only when the vault is available; otherwise it keeps them in the current session's memory. Keys are used to authenticate connection checks and service requests. They are excluded from map and image exports and do not pass through a project-operated server.

You can remove keys in connection settings or clear application storage with Clear and restart. If a key may have leaked, also revoke it with the issuing provider; deleting a local copy does not invalidate it.

Local encryption cannot prevent malicious extensions, a compromised device or malicious code running in this site's context from using keys. On a shared device, check the local storage state and clean it up after use.

## 8. Site Visits, Logs and Analytics

Loading the site, fonts, images or local-model resources sends ordinary request information to hosting and delivery services, such as an IP address, requested path, time and browser identifier. These services use it to deliver files, diagnose problems and prevent abuse. The project has no separate application-log service that receives maps or drafts.

Hosting or delivery platforms may provide aggregate traffic statistics. Their actual services and settings govern logs and retention. Request information such as IP addresses may still identify a visitor.

Application traffic statistics are limited to aggregate figures provided by hosting or delivery platforms. Browsers may send Do Not Track (DNT) or Global Privacy Control (GPC) signals; these do not change handling under the tool's current data uses. If relevant uses are introduced, we will update the explanation and implement the choices required by applicable law.

## 9. Where Information May Be Processed

- Site files: {hostNetwork}.
- Delivery: {edgeDelivery}
- Correspondence: we use a Microsoft Outlook mailbox to handle inquiries and reports.
- Online AI: the provider, aggregator or custom endpoint you connect receives requests; that service determines its processing regions.
- Model directories and external pages: Models.dev, GitHub, Bilibili and sponsorship platforms process requests according to their services.

Using the mainland China site does not mean that every external request is processed within mainland China. Selecting an overseas service, opening an external site or sending email may involve cross-border transmission. We will meet notice, consent and other duties that applicable law places on us; browser-direct connections do not themselves remove those duties.

## 10. Retention

| Information | Retention arrangement |
| --- | --- |
| Local application data | Normally until you clear it or the browser or device removes it; session-memory data is released when the relevant session ends |
| General correspondence and IP requests | Up to 24 months after the matter is resolved |
| Security reports | Kept as needed to maintain the relevant code and verify fixes; the current schedule retains them for the life of the affected code plus 12 months |
| Hosting, delivery and security logs | Under the actual provider policy and applicable configuration |
| Online AI and connection requests | Under the recipient's policy, service tier and applicable agreement |
| Exported or shared files | Kept separately by you, recipients and platforms; the project has no central copy to delete |

We delete information we hold according to the applicable schedule once it is no longer needed. Legal retention duties or an ongoing dispute may justify a limited extension. The project cannot set a single retention period for third parties. Information is treated as anonymous only when it meets the requirements for irreversible anonymization.

## 11. Content Checks and Automated Processing

Automatic content checks examine the work being exported to determine whether it can be previewed or exported with the current settings. They also screen the text of Agent tasks and custom illustration style text before a request leaves your device, so a refused request is not sent to a provider. The checks compare text and recognized image text against bundled vocabulary data on your device; they do not use an external moderation service, and the vocabulary data is delivered from this site.

If a check appears incorrect, you can adjust the content or retry where the interface permits, or send feedback to {email}. Local checks do not send us the text being checked, and we do not store it through those checks. You choose what material to include in a report.

## 12. Your Choices and Rights

You can use local editing and available local styles without connecting an online AI service. You can remove keys in connection settings, clear Agent records or clear the site's application data.

Depending on applicable law, you may have rights to information, access, copies, correction, deletion, restriction or objection, withdrawal of consent, and portability in specified circumstances. For information we actually process, contact {email}. We will uphold your exercise of these rights as required by law.

We may verify identity to the extent necessary. If we cannot locate information, fulfill a request or delete all of it, we will explain the reason and available remedies, following applicable response deadlines. Data held only in your browser usually needs to be managed on your device. Contact the relevant service for data independently held by a third party.

## 13. Minors

The tool is intended for a general player audience and has no age-registration or profiling system. Parents or guardians should guide minors according to their age and understanding, particularly regarding online-service eligibility, fees and information sent. A minor may connect an AI service only if its terms allow their use and any required guardian consent is in place.

If a guardian believes a minor's personal information was improperly provided to us, contact {email}. We will investigate and delete the information, restrict its processing or take other measures as required by law. Any applicable legal retention requirement will be explained.

## 14. Security Measures and Incident Handling

We use measures appropriate to this tool, including encrypted site transport, restrictions on script sources, encrypted key storage where supported and reduction of key exposure in error messages. Remote custom endpoints use HTTPS; a loopback endpoint you explicitly configure may use HTTP.

These measures have limits. If an incident affects information we process, we will take necessary measures and meet applicable notification and reporting duties. Vulnerabilities can be reported privately under the [Security Policy](/security).

## 15. Policy Updates

Changes to processing purposes, methods, recipients or other important matters will be reflected in this policy, its version and effective date, with a reasonable explanation of the changes. We will provide advance notice or obtain new consent where required by applicable law.

Published versions can be found in the [project repository]({repo}). The current official page is at [{origin}]({origin}).

## 16. Contact and Complaints

Send privacy questions and personal-information requests to {email}. [Contact](/contact) lists the available channels. You may also complain to a competent authority or seek other remedies under applicable law; contacting us first is not a condition of exercising those rights.
