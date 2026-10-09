# Mohalla Connect: Market, User and Regulatory Research (India, October 2026)

> **How to read this document.** It is a desk-research report compiled on 9 Oct 2026 from web search and page fetches. It has about 170 cited URLs, which were collected automatically; 83 of them were spot-checked in Oct 2026 (see Verification log at the end) — the rest have not been re-checked; spot-check the ones you rely on. **Reddit could not be accessed** from the research environment (see the caveats below). Legal points are from secondary commentary, not legal advice.
>
> **What this codebase already does with these findings:**
> - **#1 Ads stay out of safety channels.** Ads never appear in alerts, notices or pushes, and the feed shows at most one ad.
> - **#2 Each resident consents individually.** Sign-up records the resident's own consent (`consentAt`, `consentVersion`) under the DPDP Act, and a privacy notice is readable before sign-up.
> - **#3 Security.** An adversarial audit led to 23 regression tests.
> - **#4 No Aadhaar.** Verification uses GPS, the RWA, an invite code or vouches.
> - **#6 Friction against profiling.** The alert composer requires confirming "behaviour, not identity".
> - **#7 RWA-led onboarding.** RWAs onboard residents with invite codes and auto-approve.
> - **#10 Self-serve local ads.** Ads are flat-budget and self-serve, paid from a closed-loop wallet.
> - **D3 IT Rules.** A grievance contact is shown in the app.
> - **D4 TRAI DLT.** The SMS route is MSG91 via the Supabase Send-SMS hook, because Textlocal has shut down.
>
> **Not built yet:**
> - #5 a separate worker-facing app
> - #8 WhatsApp integration
> - #9 multilingual UI and a guard/gate app
> - Visitor/gate management
> - Maintenance-fee collection (it has RBI implications; see D5)


**Scope:** a hyper-local, verified community app for Indian housing societies/RWAs, local businesses and informal workers.
**Method:** web search and page fetches, 9 Oct 2026. Every claim below cites a URL. If I couldn't find a source, the text says "no source found".

**Methodology caveats (read first)**
- **Reddit:** I couldn't access Reddit directly. Fetching reddit.com was blocked in this environment, and the search engine returned no reddit.com threads for any of the subreddits requested, even with `site:reddit.com` queries. Resident "voice" therefore comes from other first-person sources: App Store reviews, X/LinkedIn posts, a Google Groups society mailing list, a Team-BHP forum thread (via search snippet), consumer-complaint sites (Voxya), and journalism (Rest of World, The Ken, The Morning Context, Deccan Chronicle). Someone should read Reddit manually before launch to validate these themes.
- **Play Store:** the review pages wouldn't render. Third-party Play-review aggregators (Kimola) returned HTTP 410. App Store pages did load.
- **Vendor sources:** many pricing and rate-card figures come from vendors (ad agencies, ADDA, NoBrokerHood, Codingclave) and are labelled as such.
- **Law:** points are from secondary legal commentary unless a statute or regulator page is cited. Verify them with counsel and the Gazette before relying on them.

---

## Part A. Top 10 actionable product recommendations, ranked by evidence strength

Ranking key:
- **Strong:** several independent sources, including first-person user evidence and/or statute.
- **Medium:** one or two good sources, or vendor plus journalism.
- **Weak:** vendor-only or indirect evidence.

### 1. Never mix ads into the security/approval notification channel (Strong)

Gate-approval alerts can't be muted, so ads delivered through the same channel are the most-cited resident grievance against MyGate.

**Evidence**
- *The Morning Context* (31 Oct 2022) reported MyGate pushing ads as push notifications, for example "8 hours left! Get vitamin tests at Rs 199". Users said turning notifications off would break visitor entry/exit management. https://www.themorningcontext.com/internet/can-advertising-save-mygate
- App Store review "Ad Overload" (10 May 2024): "Showing adds as an notification for your property seems like a spam". The developer replied that the app "uses an ad-supported model… on a free/basic tier" and suggested upgrading. https://apps.apple.com/in/app/mygate-premium/id1101762651
- The same listing shows the ad-free price: Premium is ₹99/month or ₹999/year. https://apps.apple.com/in/app/mygate-premium/id1101762651
- An X user wrote: "I hate MyGate… cant [turn off notifications] because my society mandates it for Swiggy delivery. But most notifications are ads." https://x.com/peeleraja/status/1612305941579300866
- A housing-society Google Group thread, "Spamming of MyGate notice", warned that residents would miss real notices. https://groups.google.com/g/myhomevihanga/c/zmkyenXrQIY
- MyGate's co-founder posted publicly about the backlash ("Stop your stupid f***ng ads"). https://www.linkedin.com/posts/abhishekkumariima_stop-your-stupid-fng-ads-and-f-mygate-activity-6974959157670002688-N_EB
- MyGate sells ad slots inside the approval flow: a "Post Approval Card" shown after approve/deny, and push notifications that stay up for 24 hours. https://www.themediaant.com/blog/?p=27346
- The Ken (30 Jan 2024): when a Pune society moved to the free NoBrokerHood, residents found it "carried more ads", and some suspected the committee of taking a kickback. https://the-ken.com/story/nobroker-wanted-to-eat-mygates-lunch-but-housing-societies-had-other-ideas/

**Product action**
- Use separate notification channels, at OS level and in the app, for:
  - security and approvals (never carries ads)
  - society notices
  - neighbourhood feed
  - offers
- Make "offers" opt-in. Keep ads to the feed and a business directory.
- Put this in the marketing copy as a "no ads in your gate alerts" guarantee. It is a clear way to stand apart from MyGate.

### 2. Get each resident's own consent; don't treat an RWA mandate as consent (Strong)

**Evidence**
- Deccan Chronicle (31 Jan 2020), Hyderabad residents:
  - "By default, it is not 'opt in' but 'opt out'… You have no choice but to use MyGate if your RWA has decided."
  - The opt-out was "hidden behind many settings' screens".
  - On data shared with delivery apps: "How can Swiggy and Dunzo share my data with MyGate without my consent?"
  - https://www.deccanchronicle.com/nation/current-affairs/310120/hyderabad-residents-using-mygate-feel-insecure.html
- Kaanoon legal forum: a resident whose RWA shared visitor photos and phone numbers with a third party without consent and with no retention policy. https://www.kaanoon.com/247596/rwa-sharing-information-with-a-third-party-without-consent
- Voxya complaint: a resident was forced to sign up because of the society tie-up and then couldn't delete the account themselves. https://voxya.com/consumer-complaints/not-deleting-my-account/178190
- The law points the same way. DPDP Act s.6(1) requires consent that is "free, specific, informed, unconditional and unambiguous with a clear affirmative action". Under s.6(4), withdrawing must be as easy as giving consent. https://dpdpa.com/dpdpa2023/chapter-2/section6.html
- Commentary treats the RWA/managing committee as a data fiduciary that stays responsible even when it uses a vendor app.
  - Law firm: https://ksandk.com/data-protection-and-data-privacy/dpdp-act-rwa-compliance-guide/
  - ADDA (vendor): https://blog.ind.adda.io/2026/02/dpdp-act-for-housing-societies-guide-for-rwas/
- ADDA (vendor) notes that residents stop using apps when privacy feels uncertain, and RWAs then go back to manual processes. https://blog.ind.adda.io/2025/11/common-challenges-faced-by-rwas/

**Product action**
- Ask each resident for consent, layered and itemised, with a self-serve account deletion button.
- Never share data with delivery or ad partners by default.
- Keep a per-society Data Processing Agreement that defines who is fiduciary and who is processor.
- Show visitors and workers a short notice at the gate, in their language.

### 3. Treat security engineering as a launch feature (Strong)

**Evidence**
- ADDA (society app) breach: a hacker posted 1.86 million user records (owner IDs, names, phones, emails, MD5-hashed passwords) on 23 Nov 2025. The intrusion allegedly happened in March 2025, and ADDA had made no public statement at the time of reporting. https://entrackr.com/snippets/hacker-claims-leak-of-186-mn-addaio-records-10814550
- MyGate and NoBrokerHood publicly accused each other of stealing confidential data (2020 legal notice and police complaint). https://inc42.com/buzz/mygate-vs-nobroker-tiger-global-backed-startups-wrestle-over-data-theft-allegations/
- DPDP penalties:
  - up to ₹250 crore for failing to take reasonable security safeguards
  - up to ₹200 crore for failing to notify a breach
  - https://dpdpa.com/theschedule.html
- The DPDP Rules require a detailed breach report to the Board within 72 hours. https://cpl.thalesgroup.com/sites/default/files/content/compliance_brief/india-dpdp-rules-2025-compliance-guide-cb.pdf

**Product action**
- Use modern password hashing, or better, OTP/passkeys only.
- Encrypt PII fields. Store as little as possible: no ID images, no full Aadhaar numbers.
- Write a 72-hour breach runbook. Run a third-party penetration test before launch.
- Publish a short security page.

### 4. Verify without collecting Aadhaar (Strong)

Use the Aadhaar QR offline check, DigiLocker, phone OTP plus RWA approval, and neighbour vouching.

**Evidence: why not to collect Aadhaar**
- Puttaswamy (2018) struck down the contractual-use part of Aadhaar Act s.57. "private companies won't have the authority to demand one's Aadhaar ID"
  - https://inc42.com/?p=137226
  - https://vinodkothari.com/2018/10/the-supreme-court-aadhaar-verdict-major-blow-to-fintech-companies/
- The Jan 2025 "Good Governance" amendment rules let private entities do online Aadhaar *authentication* only after central-government/UIDAI approval of a proposal. Critics say this "attempts to virtually re-legislate what was struck down."
  - https://scroll.in/latest/1078654/it-ministry-notifies-rules-allowing-private-entities-to-carry-out-aadhaar-authentication
  - https://www.medianama.com/2025/02/223-private-companies-aadhaar-authentication/

**Evidence: lawful alternatives**
- *Offline* verification (Secure QR / Paperless e-KYC) is permitted for "Offline Verification Seeking Entities". It requires consent and purpose limitation, and a later amendment added a registration framework (Reg. 13A).
  - https://old.uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verifications_Regulations_2021-_Clean_copy-30122025.pdf
  - https://vinodkothari.com/2019/03/aadhaar-ordinance-paving-way-for-use-of-voluntary-aadhaar-by-private-companies/
  - https://www.indialaw.in/blog/regulatory/aadhar-offline-verification-amendments/pdf/
- UIDAI's new Aadhaar app (reported live from 30 June 2026) supports OVSE QR scanning for "visitor management" and "gig worker verification". Holders share only the required details via QR. https://www.angelone.in/news/personal-finance/new-aadhaar-app-launched-check-7-big-features-every-user-should-know
- DigiLocker "Requester" onboarding is open to Indian-registered private companies with demonstrable experience providing online services to Indian citizens and a functional website; registration is via a DigiLocker account of authorised personnel. The citizen consents to each share. There is no sandbox (testing happens in production).
  - https://cf-media.api-setu.in/resources/Partners-SOP.pdf
  - https://cf-media.api-setu.in/resources/DigiLocker-Terms-of-User-Requester-june-2025.pdf
  - https://rc.sunbird.org/use/integrations/digilocker-integration

**Evidence: Nextdoor's model**
- Nextdoor verifies addresses by postcard code, phone, credit-card billing address ($0.01 charge), SSN (historically), and invitations from verified neighbours.
  - https://albanyca.org/home/showpublisheddocument/18830/636301026146770000
  - https://www.yumacountysheriff.org/PDF/Nextdoor-presentation.pdf
- Nextdoor's app-store listing claims 100M+ verified neighbours (company marketing); its Q2 2025 investor update reports 22M weekly active users. https://s28.q4cdn.com/517578190/files/doc_financials/2025/q2/Nextdoor-Investor-Update-Q2-2025-FINAL.pdf

**Product action: verification tiers**
1. Phone OTP.
2. Address tier. Choose one of:
   - (a) RWA/admin approves the flat mapping (MyGate/NBH pattern)
   - (b) two verified neighbours vouch
   - (c) a printed QR code on the society notice board or a door-drop card (the Indian equivalent of Nextdoor's postcard)
3. Optional identity tier via DigiLocker or Aadhaar QR offline verification, storing only a "verified" flag, the date and the last 4 digits.

Never store Aadhaar images or numbers. Apply for OVSE registration if you use the Aadhaar QR route.

### 5. Build a worker-facing app with dignity built in (Strong on the problem, medium on the fix)

**Evidence**
- Rest of World (Aug 2023), on MyGate, ApnaComplex and NoBrokerHood:
  - The apps notify residents every time a domestic worker enters or leaves, "often without their consent or knowledge".
  - A worker who left early because of an injury got an angry call triggered by an exit alert with no context.
  - Workers on MyGate "cannot see their ratings nor rate the employers".
  - ApnaComplex removed its rating feature, then brought it back because there was demand.
  - Of the 14 workers interviewed, workers "did not even understand all the features". Workers have no app interface; guards log their attendance.
  - https://restofworld.org/2023/home-monitoring-mygate-digital-bias/
  - Also summarised by Business & Human Rights Resource Centre: https://www.business-humanrights.org/fr/dernières-actualités/india-housing-security-apps-facilitate-hyper-surveillance-of-domestic-workers/
- Social sensitivity is high:
  - Urban Company renamed "Insta Maids" (₹49/hour intro) to "Insta Help" within days after backlash in March 2025. https://www.outlookbusiness.com/start-up/news/urban-company-renames-insta-maids-to-insta-help-after-backlash
  - Urban Company workers protested commission hikes to "over 30%" (workers sought a 20% cap). https://amp.kr-asia.com/home-services-marketplace-urban-company-faces-heat-from-women-workers-over-unfair-work-practices
  - Societies segregating lifts or fining workers for using the main lift drew public backlash.
    - Hyderabad: https://www.shethepeople.tv/news/hyderabad-housing-society-faces-backlash-for-fining-service-workers-1711958
    - Mumbai: https://scroll.in/article/1084949/how-separate-lifts-in-mumbai-highrises-sustain-caste-prejudice-in-the-city
- The legal basis is unclear. DPDP s.7(i) allows processing without consent "for the purposes of employment". Whether a society-wide attendance log counts as "employment" processing by each household is untested; I found no ruling. https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html

**Product action**
- A worker app (Hindi/regional, voice-first, works on low-end phones) where workers:
  - see and dispute their own reviews
  - control which households see their attendance
  - mark "left early: reason"
  - carry a portable verified profile across societies
- Reviews are visible to the worker, moderated, and limited to job-relevant categories, with no free-text slurs. Use friction on discriminatory language in the style of Nextdoor (next item).
- Never describe workers as "maids" in product copy.

### 6. Use design friction against profiling, as Nextdoor did (Medium)

**Evidence**
- Nextdoor redesigned its crime and safety posting form to require descriptors beyond race (e.g. clothing, shoes, age, build). Nextdoor reported a 75% reduction in posts containing racial profiling in test markets (Aug 2016). This is a company-reported number.
  - https://www.geekwire.com/2016/qa-nextdoor-ceo-explains-social-network-cracking-racial-profiling/
- Nextdoor's "Kindness Reminder": 1 in 5 users who saw the prompt edited their comment (unverified — source returned 403/blocked at check time). https://www.inman.com/2019/09/20/nextdoor-tries-to-curb-incivility-with-kindness-reminders/
- The Indian equivalents are class, caste, religion and nationality profiling of workers and outsiders.
  - Rest of World: https://restofworld.org/2023/home-monitoring-mygate-digital-bias/
  - Hyderabad police statements singling out Nepali workers: https://www.siasat.com/more-than-18000-residents-register-domestic-help-under-mee-suraksha-3477085/

**Product action**
- A structured "suspicious activity" form, with no fields for caste, religion or community.
- Pre-post nudges in Hindi and regional languages.
- Moderator escalation for posts naming individual workers.

### 7. Cold start: sell to the RWA committee, free for residents, guard-first UX, and do things that don't scale (Medium–Strong)

**Evidence from MyGate**
- The founders shadowed guards for nearly a month and built a phone-dial-style interface modelled on how guards already used phones. https://www.businesstoday.in/amp/trending/story/this-iit-iim-grad-took-a-guards-job-to-build-mygate-now-valued-at-rs-1670-crore-484966-2025-07-16
- MyGate offered training guards "any time and any number of times". https://www.thenewsminute.com/article/mygate-raises-rs-65-crore-series-round-led-prime-venture-partners-90156
- 1,000 communities in about 18 months, using leased guard devices (The Ken, Dec 2018). https://the-ken.com/story/mygate-could-use-a-leg-up/
- Today MyGate offers a "low-cost subscription plan or… even a complimentary model" and monetises through ads. https://inc42.com/buzz/mygate-trims-fy25-loss-by-61-to-%E2%82%B915-4-cr/

**Evidence from NoBrokerHood**
- Launched free against MyGate's paid plan (2018). About four years later it began *paying* societies to adopt it.
- One 300-flat Pune society switched from paying MyGate ₹28,000/year. Residents suspected a committee kickback.
- https://the-ken.com/story/nobroker-wanted-to-eat-mygates-lunch-but-housing-societies-had-other-ideas/

**Evidence from Nextdoor**
- A founding member must recruit about 10 households (earlier: 9 neighbours within 21 days; unverified — source returned 403/blocked at check time). The founder names the neighbourhood and draws its boundary.
  - https://en.wikipedia.org/wiki/Nextdoor
  - https://www.inman.com/news/2012/07/24/nextdoor-raises-186-million
- Nextdoor paid to print and mail invitation postcards ("millions of dollars"). https://www.alexanderjarvis.com/nextdoor-doing-things-that-dont-scale
- It worked with city officials and police, and with local press. https://glasp.co/youtube/tvHAcc2UOlg
- It focused on growth before monetisation. https://techcrunch.com/?p=932391

**Evidence from failures**
- Google Neighbourly (Mumbai Q&A, 2018–2020) shut because it "did not get the traction" it hoped for, likely because it lacked enough users for an engaging experience.
  - https://techcrunch.com/2020/04/01/google-to-shut-down-its-india-focused-qa-app-neighbourly
  - https://thenextweb.com/news/google-is-shutting-down-its-neighbourly-app
- Manch (Indian Reddit-style local discussion) shut after about 2 years because it was "unable to attract users at the expected scale" and lacked contributors. https://inc42.com/buzz/social-platform-manch-may-shut-its-operations/

**Product action**
- Go to market society by society, through the committee, with free resident apps.
- Run white-glove onboarding: on-site guard training plus a QR poster and door-drop flyer per tower.
- Require a "founding committee" of at least 10 verified flats before the society feed opens.
- Lead with utility (gate, notices, payments, staff), not social Q&A. Q&A-first launches (Neighbourly, Manch) died.
- Don't pay committees cash. It created distrust.

### 8. Integrate WhatsApp instead of fighting it (Medium)

**Evidence**
- Team-BHP (2023): a resident of an 11-flat building said apps add "no value"; "Communication… is done via Whatsapp groups". https://www.team-bhp.com/forum/shifting-gears/266681-mygate-vs-apnacomplex-vs-nobroker-vs-other-society-management-apps-2.html (search snippet; the page returned 403 to direct fetch)
- ADDA (vendor) on the downside of WhatsApp groups: "message overload, misinformation, and no official record". https://blog.ind.adda.io/2025/11/common-challenges-faced-by-rwas/
- 60% of about 1,010 MSMEs use WhatsApp Business for sales, marketing and customer interaction (India SME Forum / IPSOS, Mar 2025). https://www.mediainfoline.com/brand/overregulation-of-data-and-digital-tools-risks-undermining-msme-success-in-india-reveals-india-sme-forum-survey
- WhatsApp Business API cost in India:
  - utility and authentication about ₹0.115 per message, marketing about ₹0.86 (Jan 2026)
  - utility templates sent inside an open 24-hour service window are free
  - https://montymobile.com/blogs/whatsapp-business-api-pricing-in-india-inr-rates-gst-and-the-2026-currency-migration-deadline
  - https://support.myoperator.com/portal/en/kb/articles/whatsapp-has-shifted-to-per-message-pricing-effective-july-1-2025-based-on-message-categories-and-your-recipient-s-country-in-india-there-are-three-paid-categories
- An unverified vendor claim says WhatsApp open rates are 95%+ against 8–14% for society apps. No primary source found. https://richautomate.in/blog/whatsapp-apartment-society-rwa-india-2026

**Product action**
- Share official notices and polls to WhatsApp with deep links.
- Offer WhatsApp utility-template fallbacks for gate approvals when push notifications fail.
- Let businesses take enquiries on WhatsApp.
- Keep the app as the "system of record": official notices, votes, dues.

### 9. Multilingual UI, offline-tolerant guard app, low-end device support (Medium)

**Evidence**
- 57% of internet users prefer regional-language content (IAMAI–Kantar 2024). https://www.businesstoday.in/amp/technology/news/story/indias-internet-revolution-key-insights-from-kantar-and-iamai-report-461043-2025-01-16
- 13% of offline respondents cite unavailability of local-language content as a reason (same source).
- NoBrokerHood's guard app markets 8 languages and offline entry that syncs later in basements and dead zones. https://www.nobrokerhood.com/solutions/gatekeeper-app
- I found no published language list for MyGate's guard app.
- Team-BHP users doubt that elders and guards can manage these apps. Same thread as in #8.
- MyGate users complain about connectivity errors.
  - https://g2.com/products/mygate/reviews
  - https://kimola.com/reports/unlock-insights-with-our-mygate-app-feedback-report-google-play-en-us-152154 (now returns 410; search snippet only)
- Device mix: IDC data reported by Business Today (12 Aug 2026) show phones under $100 fell from 18% to 8% of shipments (Q1 2026) as DRAM/NAND costs rose; overall Q2 2026 shipments fell 11.1% y/y. New low-end phones are getting scarcer, but the installed base of older low-end phones still matters for workers and guards. https://www.businesstoday.in/technology/news/story/india-smartphone-market-hits-five-year-low-phones-under-rs-10000-are-fast-disappearing-548685-2026-08-12

**Product action**
- Launch in Hindi plus the language of each launch city.
- Make the guard app offline-first, icon- and photo-led, with voice prompts.
- Ship a lightweight Android build or PWA for workers.
- Allow IVR or missed-call fallbacks (MyGate offers IVR calls as a premium perk). https://help.mygate.in/articles/129768-how-to-buy-premium-plan-and-does-the-premium-user-plan-apply-to-all-users-of-the-flat

### 10. Hyperlocal ads: flat-fee, self-serve, priced against offline society media (Weak–Medium)

**Evidence: offline society media rate cards (vendor sources)**
- Notice boards, tier 2/3: "₹500–1,500 per society per month".
- Gate banners, tier 1: "₹5,000–15,000 per month per society".
- Static lift panels, tier 1: "₹800–2,000 per lift per month".
- Source: https://smartads.in/blogs/why-society-media-advertising-is-the-smartest-hyperlocal-play-for-indian-brands-targeting-gated-communities
- Apartment lift posters, Mumbai: ₹1,150 per poster per month, with minimum billing of ₹14,700. https://www.themediaant.com/nontraditional/apartment-mumbai-advertising/lift-branding

**Evidence: digital and directory pricing**
- Society-app ads "CPMs as low as ₹50" (NoBrokerHood blog, vendor claim). https://www.nobrokerhood.com/blog/hyperlocal-advertising/
- MyGate ad formats (banner, post-approval card, push, interstitial, brand page) and audience: 1.6M MAU, 0.5M DAU, 4% average CTR (May 2022–Apr 2023). The page gives no price. https://www.themediaant.com/blog/?p=27346
- Nextdoor self-serve: Local Deals from $1 and ads from $5/day (third-party). The UK launch said "minimum spend of just a few pounds".
  - https://us.fitgap.com/products/nextdoor-business
  - https://about.nextdoor.com/gb/news/nextdoor-announces-new-self-serve-ads-platform-for-small-businesses
- Justdial averaged about ₹17,600/year per paid listing in 2014 (unverified — source returned 403/blocked at check time). This is old; current pricing is not published. https://www.valueresearchonline.com/stories/28027/dialling-it-right/

**Evidence: MSME channels**
- Facebook (49%) and Google Search (43%) are the most-used ad platforms among MSMEs that advertise digitally (ISF/IPSOS). https://www.mediainfoline.com/brand/overregulation-of-data-and-digital-tools-risks-undermining-msme-success-in-india-reveals-india-sme-forum-survey
- A vendor recommends Google Business Profile plus WhatsApp for local service businesses. https://upgrowth.in/wp-content/uploads/2026/04/digital-marketing-for-small-businesses-in-india-slides-1.pdf

**Evidence gap:** I found no independent data on what Indian kirana shops or salons will pay for in-app hyperlocal ads. The price points above are vendor rack rates for offline society media.

**Product action**
- A hypothesis to test, not a finding: a flat monthly "Mohalla listing plus N promoted posts" package priced at or below a single notice-board slot (about ₹500–1,500/month per society cluster).
- Prepaid ad credits usable only for Mohalla's own ad products (see the compliance section on PPIs).
- Keep ads out of the gate and alerts channels (#1).

**Also noted (evidence for direction, not ranked):** utility features beyond gated societies.
- Shuru (tier-2 hyperlocal: local news, classifieds, shop promotion) raised about ₹29 crore in May 2025 and claims a user base of 1 crore (company claim; not an MAU figure). https://inc42.com/buzz/roposo-cofounders-hyperlocal-community-startup-shuru-bags-inr-29-cr/
- Nextdoor's 2025 "NEXT" relaunch pivoted toward alerts (weather, traffic, safety, service interruptions), local news and AI-summarised recommendations. https://axios.com/2025/07/15/nextdoor-app-ai-reboot
- This supports alerts and recommendations as engagement drivers, for example water-tanker and power-cut alerts. Indian demand for tanker coordination is documented.
  - Bengaluru's government tanker app had about 10k downloads and a 2.8 rating: https://www.deccanherald.com/india/karnataka/bengaluru/bwssb-plans-long-term-sanchari-cauvery-pacts-for-bengaluru-residents-4091007
  - RWA WhatsApp groups dominated by water updates: https://www.pressreader.com/india/hindustan-times-chandigarh/20190324/281921659390449

---

## Part B. Competitive landscape (summary)

| Player | What it is | Business model / pricing (sourced) | Known failure modes / issues |
|---|---|---|---|
| **MyGate** | Gate/visitor, daily help, dues, amenity booking, helpdesk, notices/polls, ERP; claims 27K+ communities and 5M+ homes ([mygate.com](https://mygate.com/)) | Ads plus SaaS plus hardware (smart locks since Oct 2024). Low-cost or free plans for societies. FY25 operating revenue ₹173.5 Cr, net loss ₹15.4 Cr ([Inc42](https://inc42.com/buzz/mygate-trims-fy25-loss-by-61-to-%E2%82%B915-4-cr/)). FY24 ₹96.2 Cr ([Entrackr](https://entrackr.com/fintrackr/mygate-total-revenue-nears-rs-110-cr-in-fy24-losses-shrink-by-82-7374229)). Resident ad-free plan ₹99/mo or ₹999/yr ([App Store](https://apps.apple.com/in/app/mygate-premium/id1101762651)). | Ads in notifications (Part A #1). Opt-out consent and delivery-app data sharing ([Deccan Chronicle 2020](https://www.deccanchronicle.com/nation/current-affairs/310120/hyderabad-residents-using-mygate-feel-insecure.html)). Worker surveillance ([Rest of World](https://restofworld.org/2023/home-monitoring-mygate-digital-bias/)). Conflicting statements on UPI platform fees: the blog says a platform fee may apply ([blog](https://mygate.com/blog/insights/upi-payments-on-mygate/)); the help centre says fees come from gateways and UPI is subsidised ([help](https://help.mygate.in/articles/131668-what-are-transaction-charges-that-are-showing-while-making-payment-via-mygate-app)). |
| **NoBrokerHood (NoBroker)** | Visitor, delivery and staff management, guard patrol, SOS, facility booking, accounts, complaints, polls and e-elections ([SoftwareSuggest](https://www.softwaresuggest.com/nobrokerhood)). Guard app in 8 languages, works offline ([NBH](https://www.nobrokerhood.com/solutions/gatekeeper-app)) | Free plan against MyGate's paid plan. Later *paid* societies to adopt ([The Ken, Jan 2024](https://the-ken.com/story/nobroker-wanted-to-eat-mygates-lunch-but-housing-societies-had-other-ideas/)). Society counts conflict between sources: 18,000+ vs 25,000+ ([getprospect](https://getprospect.com/business-directory/nobrokerhood), [weekday](https://jobs.weekday.works/wkdyui168c)). | More ads; residents distrust committees that switch ([The Ken](https://the-ken.com/story/nobroker-wanted-to-eat-mygates-lunch-but-housing-societies-had-other-ideas/)). Voxya complaints: no self-serve account deletion; UPI payment shown as failed; prepaid cleaning service not delivered ([1](https://voxya.com/consumer-complaints/not-deleting-my-account/178190), [2](https://voxya.com/consumer-complaints/payment-status-not-updated/135398), [3](https://voxya.com/consumer-complaints/service-not-delivered-/188462)). Team-BHP: "clunkier", fewer recurring pre-approval options, alert tone "resembles a tornado siren" ([thread](https://www.team-bhp.com/forum/shifting-gears/266681-mygate-vs-apnacomplex-vs-nobroker-vs-other-society-management-apps-2.html)). |
| **ApnaComplex (ANAROCK)** | Society ERP, billing, gate, helpdesk. About 20,000 societies and 600k households claimed at acquisition ([GPC](https://globalprivatecapital.org/?p=26061)) | Acquired by ANAROCK from NestAway (Jan 2021) ([IndianWeb2](https://www.indianweb2.com/2021/01/anarock-acquires-society-and-apartment.html?hl=ar)). Price is quoted per flat; third-party blogs say from about ₹4–6/flat/month ([Codingclave, a vendor](https://codingclave.com/blog/best-society-management-app-india-2026)). A LinkedIn commenter cited about ₹75k/year ([search result](https://www.linkedin.com/posts/prateekkole_hi-abhishek-kumar-im-forced-to-download-activity-6976412865566035969-vgSC)). | Worker rating feature removed, then brought back because there was demand ([Rest of World](https://restofworld.org/2023/home-monitoring-mygate-digital-bias/)). |
| **ADDA** | Society ERP, gatekeeper, community. Claims 25,000+ communities and 7.5M users ([ADDA](https://ind.adda.io/partners)) | Ad-free; "only revenue is from software subscriptions" ([ADDA](https://ind.adda.io/partners)). Quote-based pricing ([SoftwareSuggest](https://www.softwaresuggest.com/apartment-adda)). | **Nov 2025 breach: 1.86M records** ([Entrackr](https://entrackr.com/snippets/hacker-claims-leak-of-186-mn-addaio-records-10814550)). |
| **Nextdoor** | Verified neighbourhood network: 100M+ verified neighbours per company marketing copy (not the Q1 release, which cites 345,000+ neighbourhoods in 11 countries); Q1 2025 revenue $54M ([Q1 2025](https://investors.nextdoor.com/news/news-details/2025/Nextdoor-Reports-First-Quarter-2025-Results/default.aspx)) | Ads, including self-serve local ads. | **Never launched in India.** In 2017 the CEO named India as an expansion target ([TechCrunch](https://techcrunch.com/2017/12/11/nextdoor-raised-about-75-million-to-connect-neighbors)). Present in 11 countries per a secondary source ([thinkinsights](https://thinkinsights.net/leadership/nextdoor-business-model-2026)); no India launch found. Known issues: racial profiling, which it addressed with form redesign (Part A #6). Stock down more than 80% since its 2021 SPAC (unverified — source returned 403/blocked at check time) ([Axios](https://axios.com/2025/07/15/nextdoor-app-ai-reboot)). |
| **LocalCircles** | Citizen engagement and community platform, launched in Delhi in 2013 with RWA positioning ([ITVoice](https://www.itvoice.in/honble-chief-minister-delhi-mrs-dikshit-launched-localcircles-com)) | "Free for citizens". Funding accounts conflict ([civictech](https://civictech.guide/listing/local-circles), [Inc42](https://inc42.com/flash-feed/puneet-dalmia-invests-in-localcircles/amp/)). | App Store rating 3.0 on few reviews ([App Store](https://apps.apple.com/us/app/localcircles/id707948385?ls=1)). No current RWA product found. |
| **WhatsApp / Facebook groups** | The default society channel | Free | "Message overload, misinformation, no official record" (ADDA, vendor) ([ADDA](https://blog.ind.adda.io/2025/11/common-challenges-faced-by-rwas/)). No independent Facebook-group usage data found. |
| **Urban Company** (workers) | Home services marketplace; "Insta Help" 15-minute house help, ₹49/hr intro, ₹245/hr standard ([Outlook Business](https://www.outlookbusiness.com/start-up/news/urban-company-renames-insta-maids-to-insta-help-after-backlash)) | Commission marketplace. Strategic investor in MyGate ([Business Today](https://www.businesstoday.in/amp/entrepreneurship/story/mygate-raises-rs-100-crore-from-urban-company-and-acko-353940-2022-11-23)) | Worker protests over commission hikes to "over 30%" (workers sought a 20% cap) ([KrASIA](https://amp.kr-asia.com/home-services-marketplace-urban-company-faces-heat-from-women-workers-over-unfair-work-practices)); ID blocking ([The Ken](https://the-ken.com/story/urban-company-is-caught-between-angry-customers-and-angrier-partners/)). |
| **Justdial** | Local search and directory | Free basic listing; paid priority listings priced by city, category and package ([markhub24](https://www.markhub24.com/post/justdial-s-local-search-monetization-model)). About ₹17,600/yr average in 2014 (unverified — source returned 403/blocked at check time) ([Value Research](https://www.valueresearchonline.com/stories/28027/dialling-it-right/)). | Telesales-driven; a complaint describes a listing not activated after payment ([Voxya](https://voxya.com/consumer-complaints/paid-listing-just-dail/109814)). |
| **Google Business Profile / Maps** | Free local listings | Free; Google Ads for paid reach | Google itself shut Neighbourly and pointed users to Local Guides/Maps ([TechCrunch](https://techcrunch.com/2020/04/01/google-to-shut-down-its-india-focused-qa-app-neighbourly)). |
| **Shuru** (2021–) | Hyperlocal app for tier-2 cities: local news, classifieds, shop promotion | Series A of about ₹29 Cr led by Krafton (May 2025). Claims a user base of 1 crore (company claim; not an MAU figure) ([Inc42](https://inc42.com/buzz/roposo-cofounders-hyperlocal-community-startup-shuru-bags-inr-29-cr/)) | Too early; claims are unverified. |
| **Lokal / Public (Inshorts)** | Hyperlocal content, classifieds, location-based video | Lokal Series B ₹120 Cr ([Inc42](https://inc42.com/startups/lokal-app-bharat-revenue-hyperlocal-classifieds-series-b-funding/)). Public reportedly burned $2M per month ([OfficeChai](https://officechai.com/startups/inshorts-owned-app-public-raises-41-million-now-valued-at-250-million/)) | Expensive to run; Inshorts lost ₹228 Cr in FY24 ([Wikipedia](https://en.wikipedia.org/wiki/Inshorts)). |
| **Shutdowns** | Google Neighbourly (2020); Manch (about 2020); Dunzo (Jan 2025) | — | Neighbourly and Manch: too few users or contributors ([TechCrunch](https://techcrunch.com/2020/04/01/google-to-shut-down-its-india-focused-qa-app-neighbourly), [Inc42](https://inc42.com/buzz/social-platform-manch-may-shut-its-operations/)). Dunzo: drifted from trusted hyperlocal errands into capital-heavy quick commerce, burning over ₹230 per order ([Rest of World](https://restofworld.org/2025/dunzo-shutdown-india-quick-commerce/), [Outlook Business](https://www.outlookbusiness.com/start-up/e-commerce/dunzos-downfall-explained-what-led-reliance-to-write-off-entire-200-million-stake-in-start-up)). I found no 2023–2026 shutdown of a pure "Indian Nextdoor". |

---

## Part C. Top recurring resident complaints (with sources)

1. **Ads and notification spam that can't be muted** (MyGate; NoBrokerHood after switches). Part A #1.
   - Sources: [Morning Context](https://www.themorningcontext.com/internet/can-advertising-save-mygate), [App Store](https://apps.apple.com/in/app/mygate-premium/id1101762651), [X](https://x.com/peeleraja/status/1612305941579300866), [Google Group](https://groups.google.com/g/myhomevihanga/c/zmkyenXrQIY)
   - A Play Store reviewer, quoted in a search snippet: ad-free has to be bought "per person using the app - its not even a fee per flat". [Play](https://play.google.com/store/apps/details?id=com.mygate.user)
2. **Forced adoption by the RWA, opt-out consent, data shared with third parties.**
   - Sources: [Deccan Chronicle](https://www.deccanchronicle.com/nation/current-affairs/310120/hyderabad-residents-using-mygate-feel-insecure.html), [Kaanoon](https://www.kaanoon.com/247596/rwa-sharing-information-with-a-third-party-without-consent)
   - "I'm forced to download MyGate because my apartment…" (LinkedIn): [link](https://www.linkedin.com/posts/prateekkole_hi-abhishek-kumar-im-forced-to-download-activity-6976412865566035969-vgSC)
3. **Data security and breaches.**
   - ADDA breach: [Entrackr](https://entrackr.com/snippets/hacker-claims-leak-of-186-mn-addaio-records-10814550)
   - MyGate and NBH data-theft allegations: [Inc42](https://inc42.com/buzz/mygate-vs-nobroker-tiger-global-backed-startups-wrestle-over-data-theft-allegations/)
4. **Account and data deletion is hard.** [Voxya](https://voxya.com/consumer-complaints/not-deleting-my-account/178190)
5. **Payment issues and fee confusion.**
   - NBH UPI payment succeeded but showed "failed": [Voxya](https://voxya.com/consumer-complaints/payment-status-not-updated/135398)
   - MyGate's conflicting fee statements: [blog](https://mygate.com/blog/insights/upi-payments-on-mygate/) vs [help](https://help.mygate.in/articles/131668-what-are-transaction-charges-that-are-showing-while-making-payment-via-mygate-app)
6. **Connectivity, login and notification reliability.**
   - [G2](https://g2.com/products/mygate/reviews), [MyGate help on login errors](https://help.mygate.in/articles/134833-why-am-i-unable-to-login-to-mygate-application)
   - Play reviewer: premium "randomly… misses sending notifications" (search snippet, [Play](https://play.google.com/store/apps/details?id=com.mygate.user))
7. **Visitor-management friction.**
   - MyGate itself calls talking to guards for expected deliveries "annoying, if not inconvenient": [MyGate blog](https://mygate.com/blog/society-focus/silences-deliveries/)
   - NBH lacks weekly or monthly recurring pre-approvals (milk, BigBasket); a user notes pre-approval works "only once a day for each vendor": [Team-BHP](https://www.team-bhp.com/forum/shifting-gears/266681-mygate-vs-apnacomplex-vs-nobroker-vs-other-society-management-apps-2.html), [X thread](https://x.com/peeleraja/status/1612305941579300866)
8. **Over-sharing inside households.** App Store review "stalking and being stalked by our own family members": [App Store](https://apps.apple.com/in/app/mygate-premium/id1101762651)
9. **Worker surveillance and unfair ratings** (raised mainly by researchers and workers rather than residents): [Rest of World](https://restofworld.org/2023/home-monitoring-mygate-digital-bias/)
10. **Usability for elders and guards; no value for small buildings**: [Team-BHP](https://www.team-bhp.com/forum/shifting-gears/266681-mygate-vs-apnacomplex-vs-nobroker-vs-other-society-management-apps-2.html)
11. **Committee trust and transparency**, including switching vendors and kickback suspicions and opaque maintenance hikes.
    - [The Ken](https://the-ken.com/story/nobroker-wanted-to-eat-mygates-lunch-but-housing-societies-had-other-ideas/)
    - [Outlook Money](https://www.outlookmoney.com/magazine/how-rwas-are-failing-residents)
    - [PropNewsTime: Godrej Oasis CAM hike](https://propnewstime.com/latestnewsstories/MzM0MTU=/godrej-oasis-residents-protest-maintenance-fee-hike-demand-rollback-and-transparent-society-management)

---

## Part D. "Must-fix for India launch" compliance checklist

*Not legal advice. Confirm every item with Indian counsel and the official Gazette or regulator text.*

### D1. DPDP Act 2023 and DPDP Rules 2025

**Timeline**
- Rules notified 13/14 Nov 2025.
  - Consent-manager provisions apply after about 12 months (≈13 Nov 2026).
  - Notice, consent, security, breach, rights, retention and children's obligations apply after about 18 months (≈13 May 2027).
- Sources: [PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf) (does not state the 12-month consent-manager phase), [Thales brief](https://cpl.thalesgroup.com/sites/default/files/content/compliance_brief/india-dpdp-rules-2025-compliance-guide-cb.pdf) (states 13 Nov 2026 and 13 May 2027), [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fcentre-notifies-dpdp-rules-implementation-planned-in-phases-spread-over-12-18-months-3798465), [compliancehub](https://compliancehub.wiki/india-dpdp-consent-manager-november-2026-phase-two-deadline-compliance/)
- **Build to the 2027 standard from day one.**

**Checklist**
- [ ] **Consent:** free, specific, informed, unconditional, unambiguous, given by clear affirmative action. Consent requests available in English or Eighth Schedule languages. Withdrawal as easy as giving consent. Stop processing, and make processors stop, after withdrawal (s.6(1), 6(3), 6(4), 6(6)). [dpdpa.com s.6](https://dpdpa.com/dpdpa2023/chapter-2/section6.html)
- [ ] **Erasure:** erase on withdrawal or once the purpose is served, including at processors (s.8(7)). [dpdpa.com s.8](https://www.dpdpa.com/dpdpa2023/chapter-2/section8.html)
- [ ] **Inactive-user erasure (Third Schedule):** applies only to social media intermediaries with at least 2 crore registered users, e-commerce entities with at least 2 crore, and gaming with at least 50 lakh. Erase after 3 years of inactivity, with 48-hour prior notice ([Thales brief](https://cpl.thalesgroup.com/sites/default/files/content/compliance_brief/india-dpdp-rules-2025-compliance-guide-cb.pdf)). Not applicable at launch, but design for it. [storyboard18](https://www.storyboard18.com/digital/breaking-dpdp-final-rules-out-consent-managers-face-tight-eligibility-e-commerce-social-platforms-get-3-year-data-limitbreaking-dpdp-final-rules-out-consent-managers-face-tight-eligibility-e-comm-84204.htm), [DPDP wiki](https://dpdp.myndsolution.com/wiki/rules/schedule-3-class-of-data-fiduciaries-purposes-time-period/) (503 at check time)
- [ ] **Children (under 18):**
  - Verifiable parental consent (DigiLocker, or a token (unverified — check Rule 10), are accepted methods).
  - No tracking, behavioural monitoring or targeted ads aimed at children (s.9).
  - Simplest path: an **18+ only** policy with age declaration, plus parental-consent flows if teens are allowed later.
  - Sources: [Thales brief](https://cpl.thalesgroup.com/sites/default/files/content/compliance_brief/india-dpdp-rules-2025-compliance-guide-cb.pdf), [Seclore](https://www.seclore.com/fundamentals/dpdp-rules-2025-compliance-guide/)
- [ ] **Security safeguards and breach notice:** notify the Board and affected users without delay; detailed report to the Board within 72 hours. Penalties up to ₹250 Cr (safeguards) and ₹200 Cr (breach notice or children). [Schedule](https://dpdpa.com/theschedule.html), [Thales](https://cpl.thalesgroup.com/sites/default/files/content/compliance_brief/india-dpdp-rules-2025-compliance-guide-cb.pdf)
- [ ] **Roles with RWAs:** commentary treats the RWA as data fiduciary for society data. Sign a fiduciary/processor agreement per society that bars secondary use, including ads targeting from society data. [KSK](https://ksandk.com/data-protection-and-data-privacy/dpdp-act-rwa-compliance-guide/)
  - For neighbourhood-feed data Mohalla Connect collects directly, Mohalla Connect itself is the fiduciary. This split is my inference; I found no source.
- [ ] **Domestic-worker data:** don't rely on the s.7(i) "employment" exemption for society-wide attendance logs without legal advice. Get workers' consent in their language. [dpdpa.com s.7](https://www.dpdpa.com/dpdpa2023/chapter-2/section7.html), [Rest of World](https://restofworld.org/2023/home-monitoring-mygate-digital-bias/)
- [ ] **CCTV, biometrics and face recognition:** avoid at launch. Commentary flags biometrics/face recognition as higher-risk; CCTV needs a documented governance framework. [KSK](https://ksandk.com/data-protection-and-data-privacy/dpdp-act-rwa-compliance-guide/)

### D2. Aadhaar
- [ ] **Do not collect, store or require Aadhaar numbers or photocopies.** Private demand for Aadhaar was curtailed after Puttaswamy (2018). [Inc42](https://inc42.com/?p=137226), [LiveLaw](https://www.livelaw.in/aadhaar-judgment-certain-concerns)
- [ ] **Online authentication** requires central-government/UIDAI approval under the 2025 amendment rules. Don't use it without that approval. [Khaitan](https://www.khaitanco.com/thought-leadership/Aadhaar-authentication-for-private-entities)
- [ ] **For Aadhaar QR or offline e-KYC:**
  - register as an OVSE under the 2021 regulations as amended (Reg. 13A)
  - take explicit consent and limit use to the stated purpose
  - follow UIDAI's OVSE do's and don'ts
  - Sources: [UIDAI regs](https://old.uidai.gov.in/images/The_Aadhaar_Authentication_and_Offline_Verifications_Regulations_2021-_Clean_copy-30122025.pdf), [UIDAI Do's/Don'ts](https://www.uidai.gov.in/images/DosandDon_ts_for_Offline_Verification_Seeking_entities.pdf)
- [ ] **Prefer DigiLocker Requester integration:**
  - Indian entity, registration via a DigiLocker account of authorised personnel, official email domain
  - demonstrable experience providing online services to Indian citizens, and a functional website
  - servers located in India for foreign firms
  - Sources: [Partners SOP](https://cf-media.api-setu.in/resources/Partners-SOP.pdf), [FAQ](https://www.digilocker.gov.in/assets/FAQ%20DL%20EL_onboarding.pdf)

### D3. IT Act, Intermediary Rules 2021 (as amended 2022 and Feb 2026)
- [ ] **Grievance officer:** publish name and contact. Acknowledge complaints within 24 hours. Resolve within **7 days**; the 2026 amendment cut this from 15. [iPleaders](https://blog.ipleaders.in/it-rules-2026/), [iPleaders 2021](https://blog.ipleaders.in/information-technology-guidelines-intermediaries-digital-media-ethics-code-rules-2021/)
- [ ] **Takedown on court or authorised government orders:** within **3 hours** (from 36), effective 20 Feb 2026. [Mondaq](https://www.mondaq.com/india-it-intermediary-rules-amended-%E2%80%93-new-obligations-for-ai-synthetic-content/1743594), [Hogan Lovells](https://www.hlc.com/en/publications/india-introduces-mandatory-labelling-for-ai-and-3hour-takedown-for-illegal-content)
- [ ] **Non-consensual intimate imagery and impersonation complaints:** within **2 hours** (from 24). [Mondaq](https://www.mondaq.com/india-it-intermediary-rules-amended-%E2%80%93-new-obligations-for-ai-synthetic-content/1743594)
- [ ] **User removal-request complaints:** 72 hours, per the 2022 *draft* amendment as reported by Newslaundry; the Verdictum report on the final 2022 rules supports only the 30-day appeal (below), not the 72-hour figure. Confirm against the final text, and whether 2026 changed it. [Newslaundry (draft)](https://www.newslaundry.com/2022/06/07/it-rules-draft-proposal-to-set-up-grievance-committee-goes-live-for-public-feedback)
- [ ] **Appeals:** support appeals to the Grievance Appellate Committee within 30 days. [Verdictum](https://www.verdictum.in/news/it-amendment-rules-2022-1445726)
- [ ] **Assistance to law enforcement:** provide information when lawfully ordered within 72 hours. [iPleaders](https://blog.ipleaders.in/information-technology-guidelines-intermediaries-digital-media-ethics-code-rules-2021/)
- [ ] **Rules reminder:** tell users at least **every three months** that violations can lead to removal or suspension (2026). [Hogan Lovells](https://www.hlc.com/en/publications/india-introduces-mandatory-labelling-for-ai-and-3hour-takedown-for-illegal-content)
- [ ] **AI features (summaries, image generation):** label synthetic content and embed provenance metadata. [Mondaq](https://www.mondaq.com/india-it-intermediary-rules-amended-%E2%80%93-new-obligations-for-ai-synthetic-content/1743594)
- [ ] **At 50 lakh registered users you become a Significant Social Media Intermediary.** Duties:
  - India-resident Chief Compliance Officer, nodal contact and resident grievance officer
  - monthly compliance reports
  - a **voluntary** verification mechanism with a visible badge (not in the cited sources — verify against Rule 4(7))
  - Sources: [Business Today](https://www.businesstoday.in/amp/latest/economy-politics/story/new-it-rules-govt-fixes-50-lakh-users-threshold-to-define-significant-social-media-intermediary-289547-2021-02-27), [iPleaders](https://blog.ipleaders.in/information-technology-guidelines-intermediaries-digital-media-ethics-code-rules-2021/)

### D4. TRAI DLT (SMS and OTP)
- [ ] Register on DLT: Principal Entity, header (sender ID) and **each template**. Carriers scrub message content against approved templates in real time. [Telerivet](https://www.telerivet.com/blog/india-sms-compliance-trai-dlt-registration-and-tcccpr-guide)
- [ ] Since 6 May 2025, operators append -P/-S/-T/-G suffixes to headers automatically. Classify messages correctly: OTP as transactional or service; offers as promotional, with consent. [EnableX](https://www.enablex.io/insights/a-step-by-step-guide-to-dlt-registration/)
- [ ] Fees: entity registration ≈ ₹5,900 + GST one-time with annual renewal; headers ≈ ₹590/year (Telerivet, vendor). [Telerivet](https://www.telerivet.com/blog/india-sms-compliance-trai-dlt-registration-and-tcccpr-guide)

### D5. RBI: ad-credit wallets, maintenance payments
- [ ] **Ad credits must stay a closed-system PPI.** The RBI defines closed-system PPIs as issued "for facilitating the purchase of goods and services from that entity only" with no cash withdrawal. The RBI does not regulate or supervise them.
  - Non-withdrawable, non-transferable credits redeemable only for Mohalla Connect's own ad products should qualify. My inference; confirm with counsel.
  - Sources: [RBI MD (updated 30 Sep 2026)](https://rbi.org.in/scripts/BS_ViewMasDirections.aspx?id=12156), [RBI FAQ](https://rbi.org.in/scripts/FS_FAQs.aspx?Id=126)
- [ ] **Do NOT let credits pay local merchants, workers or other users.** That makes the wallet semi-closed or small-PPI territory, which needs RBI authorisation.
  - The April 2026 **draft** PPI Directions keep closed-system PPIs outside RBI regulation but carve out *marketplace-issued* PPIs used to buy from marketplace sellers. Those would need authorisation.
  - Sources: [AZB, 1 Jun 2026](https://www.azbpartners.com/bank/decoding-the-key-changes-proposed-under-the-simplified-master-direction-on-prepaid-payment-instruments-issued-by-the-rbi/), [RBI draft](https://www.rbi.org.in/scripts/bs_viewcontent.aspx?Id=4987)
- [ ] **Maintenance dues:** collect only through an RBI-authorised payment aggregator, with settlement straight to the society. Don't pool funds yourself.
  - PA Directions 2025 (15 Sep 2025): non-bank PAs need authorisation and ₹15 Cr net worth at application.
  - Sources: [Inc42](https://inc42.com/buzz/rbi-issues-new-master-directions-for-payment-aggregators), [MediaNama](https://www.medianama.com/2025/09/223-explained-rbi-master-direction-payment-aggregators/)
- [ ] **Show any convenience fee before payment.** MyGate's inconsistent messaging (Part C #5) is the trap to avoid.

### D6. GST
- [ ] Charge **18% GST** on internet advertising space (SAC 998365). Sources say the rate is unchanged after the 22 Sep 2025 rationalisation (vendor sources). [BUSY](https://busy.in/sac-code-998365/)
- [ ] **Prepaid ad credits:** for services, GST time of supply is generally the earliest of invoice, provision of service or receipt of an advance. A top-up may therefore be taxable when received.
  - Get advice on voucher treatment (CGST s.12/13).
  - Sources: [GST Council flyer](https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/51_GST_Flyer_Chapter6.pdf), [Tally](https://tallysolutions.com/gst/when-is-gst-payable-on-advance-payments-rules-for-goods-vs-services/)
- [ ] For foreign tools you buy (for example Meta or Google ads), the 6% equalisation levy was abolished from 1 Apr 2025 (unverified — source returned 403/blocked at check time; abolition was proposed in the March 2025 Finance Bill amendments); 18% IGST under reverse charge still applies. [Deccan Herald](https://www.deccanherald.com/amp/story/business/govt-to-abolish-google-tax-amid-trumps-tariff-threat-3462385), [TaxGuru](https://taxguru.in/goods-and-service-tax/oidar-services-taxability.html)

### D7. Domestic-worker verification and labour
- [ ] **Don't claim police verification is "mandatory" everywhere.**
  - Delhi Police "requests" verification (Lok Sabha answer; unverified — source returned 403/blocked at check time). Penalties arise only from local orders under BNSS s.163, with BNS s.223 for violations. [eparlib](https://eparlib.nic.in/bitstream/123456789/589276/1/93073.pdf), [Kotak (tenant context)](https://www.kotak.com/en/stories-in-focus/loans/home-loan/police-verification-for-tenants.html)
  - Bengaluru treats it as "recommended": ₹375 antecedents check, ₹750 with address check, about 21 days via Seva Sindhu. [Citizen Matters](https://citizenmatters.in/a-guide-to-background-checks-for-hiring-domestic-help-and-staff-in-gated-communities/)
  - Hyderabad (Jul 2026): police "urge" verification after 565 domestic-help theft cases. Verification is free at police stations. [TNM](https://www.thenewsminute.com/telangana/hyderabad-police-urge-mandatory-verification-of-domestic-workers)
  - Malkajgiri's "Mee Suraksha" registered 18,413 workers voluntarily (May 2026). [Siasat](https://www.siasat.com/more-than-18000-residents-register-domestic-help-under-mee-suraksha-3477085/)
  - Mumbai: described as a voluntary scheme (undated source). [JaagoRe](https://www.jaagore.com/articles/know-your-police/process-for-registration-of-domestic-help-with-police)
  - No current Mumbai, Pune or Chennai mandate found.
- [ ] **Product:** link to the relevant state portal or process. Store only a worker-consented status flag and date, never the police report.
- [ ] **Karnataka gig-worker welfare fee:** if Mohalla Connect matches workers to jobs for a fee, it may be an "aggregator" under the Karnataka Platform-Based Gig Workers Act 2025. The fee is 1–5% of payouts, notified 16 Feb 2026 (the SCC Online schedule lists 1% per category).
  - Simplest way to stay outside it: a directory or reviews model without payments or commission at launch.
  - Sources: [SCC Online](https://www.scconline.com/blog/post/2026/02/18/karnataka-government-notifies-gig-workers-welfare-fee-mandatory/), [KSK](https://ksandk.com/newsletter/karnataka-notifies-platform-based-gig-workers-welfare-law/)

---

## Part E. Feature gap table: Mohalla Connect vs MyGate vs NoBrokerHood

Legend:
- **Yes:** documented by a source.
- **Not found:** I found no source. This doesn't mean the feature is absent.
- **Partial:** limited or conditional.

| Feature | MyGate | NoBrokerHood | Opportunity for Mohalla Connect |
|---|---|---|---|
| Visitor pre-approval / gate | Yes ([help/blog](https://mygate.com/blog/society-focus/silences-deliveries/)) | Yes ([SoftwareSuggest](https://www.softwaresuggest.com/nobrokerhood)) | Parity required. Add recurring weekly or monthly passes (a NBH gap per [Team-BHP](https://www.team-bhp.com/forum/shifting-gears/266681-mygate-vs-apnacomplex-vs-nobroker-vs-other-society-management-apps-2.html)). |
| Silent delivery approvals with delivery apps | Yes, opt-out consent was controversial ([DC](https://www.deccanchronicle.com/nation/current-affairs/310120/hyderabad-residents-using-mygate-feel-insecure.html)) | Not found | Opt-in only. |
| Daily-help attendance | Yes ([help](https://help.mygate.in/articles/129783-how-to-check-daily-help-attendance-from-the-app)) | Yes ([SoftwareSuggest](https://www.softwaresuggest.com/nobrokerhood)) | Worker-consented, with worker-side context such as "left early: reason". |
| Worker ratings visible to the worker / worker app | No; MyGate "plans" a worker version ([RoW](https://restofworld.org/2023/home-monitoring-mygate-digital-bias/)) | Not found | **Key differentiator** (Part A #5). |
| Portable verified worker profile across societies | Not found | Not found | **Gap.** |
| Maintenance payment (UPI) | Yes; fee messaging inconsistent | Yes; failed-status complaints | Transparent zero or clearly stated fees; authorised PA only. |
| Amenity / clubhouse booking | Yes ([mygate.com](https://mygate.com/)) | Yes ([SoftwareSuggest](https://www.softwaresuggest.com/nobrokerhood)) | Parity. |
| Polls / surveys / e-elections | Polls and surveys yes ([mygate.com](https://mygate.com/)) | Polls and e-elections yes ([SoftwareSuggest](https://www.softwaresuggest.com/nobrokerhood)) | Parity, plus auditability for state rules (e.g. Maharashtra online-voting reforms, status unclear: [mypunepulse](https://www.mypunepulse.com/?p=153749)). |
| Notices | Yes | Yes | Shareable to WhatsApp (Part A #8). |
| SOS / emergency alert | Yes, including to non-user family via IVR ([MyGate blog](https://mygate.com/blog/feature-in-focus/raise-alert-emergency-assistance/)) | Yes ([NBH](https://nobrokerhood.com/assistance-in-emergencies-and-safety-of-the-society)) | Parity. Extend to the neighbourhood: blood-donor and medical-help roster, opt-in. |
| Ad-free core alerts | Paid only (₹999/yr per user) ([App Store](https://apps.apple.com/in/app/mygate-premium/id1101762651)) | App contains ads ([App Store label](https://apps.apple.com/in/app/nobrokerhood-manage-visitors/id1357972233)) | **Free, guaranteed** (Part A #1). |
| Guard app in regional languages / offline | Not found | 8 languages, offline sync ([NBH](https://www.nobrokerhood.com/solutions/gatekeeper-app)) | Parity with NBH, plus a voice-first UI. |
| Resident UI in Hindi / regional languages | Not found | Not found | **Gap** (IAMAI: 57% prefer regional, [BT](https://www.businesstoday.in/amp/technology/news/story/indias-internet-revolution-key-insights-from-kantar-and-iamai-report-461043-2025-01-16)). |
| Cross-society or non-gated neighbourhood feed | Not found | Not found | **Core gap.** Shuru shows demand in tier-2 cities ([Inc42](https://inc42.com/buzz/roposo-cofounders-hyperlocal-community-startup-shuru-bags-inr-29-cr/)). |
| Local business directory with self-serve small-shop ads | Brand ad platform ([mygate.com](https://mygate.com/), [MediaAnt](https://www.themediaant.com/blog/?p=27346)); small-shop self-serve not found | "Monetisation campaigns" for societies and businesses ([getprospect](https://getprospect.com/business-directory/nobrokerhood)) | Self-serve, flat-fee, low minimum (Part A #10). |
| Water-tanker / power-cut / civic alerts | Not found | Not found | **Gap**; Nextdoor's 2025 relaunch centres on alerts ([Axios](https://axios.com/2025/07/15/nextdoor-app-ai-reboot)). |
| Lost & found / classifieds | Not found | Not found (NoBroker has property classifieds) | Low-cost engagement feature. |
| WhatsApp integration | Not found | Not found | **Gap** (Part A #8). |
| Identity verification without Aadhaar storage (DigiLocker / Aadhaar QR) | Not found | Staff enrolled "through their documents and photos" ([NBH](https://nobrokerhood.com/assistance-in-emergencies-and-safety-of-the-society)) | **Differentiator** (Part A #4). |
| Police-verification assistance | Not found | Blog guide only ([NBH blog](https://www.nobrokerhood.com/blog/domestic-servant-police-verification-online/)) | Guided, consented flow (D7). |
| Self-serve account deletion | Not found | Complaint that it is missing ([Voxya](https://voxya.com/consumer-complaints/not-deleting-my-account/178190)) | Required by DPDP; ship it. |
| Anti-profiling posting design | Not found | Not found | Nextdoor-style friction (Part A #6). |

---

## Part F. Open questions and evidence gaps

- **Reddit sentiment:** not retrievable here. Read r/bangalore, r/mumbai, r/delhi, r/pune, r/hyderabad manually for "MyGate", "NoBrokerHood", "society app", "RWA".
- **Small-shop willingness to pay** for in-app hyperlocal ads in India: no independent data found. Run a pricing test with 20–30 shops per pilot cluster.
- **Unverified numbers:**
  - current MyGate and NoBrokerHood society counts (company claims only)
  - WhatsApp-vs-app open rates (vendor claim, no primary source)
  - "71% of societies run on WhatsApp" (vendor claim, no primary source)
- **Untested law:**
  - whether an RWA is covered by DPDP or falls under an exemption
  - whether society-wide worker attendance qualifies under s.7(i)
  - the final 2026 PPI Directions text
  - Maharashtra's final cooperative-society online-voting rules
- **Possible mis-dating:** the YourStory/Google MSME study reports a June 2026 survey date, which may be an error. https://yourstory.com/ai-story/google-study-digital-ads-msme-growth-india-2025

---

## Verification log (Oct 2026)

83 claim/URL pairs spot-checked by fetching each source: 48 supported, 18 partly supported, 3 not supported, 5 dead links, 9 unverifiable (403/blocked). The not-supported claims and dead links have been corrected or flagged inline above; Part D statutory points (DPDP sections and penalties, IT Rules 2026 timelines, RBI PPI/PA, GST time of supply) checked out.
