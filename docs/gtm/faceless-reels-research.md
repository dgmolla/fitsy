# Faceless restaurant Reels research and Fitsy templates

**TL;DR:** One hundred six distinct Instagram and TikTok restaurant videos are documented; 44 more are needed.

> **Status:** partial research, target unmet · **Last verified:** 2026-11-04 · **Owner:** Fitsy Marketing
> This is creative research and proposed copy, not permission to publish, contact creators, or spend.

## Scope and evidence method

The current target is 150-300 distinct Instagram Reels or TikTok videos showing restaurant dishes or orders through a healthy swap, macro, protein, or surprising nutrition angle, with no presenter visible in the footage.
Signed-in viewing through Dawit's existing Chrome session is authorized for public creative research only, at a normal person's pace and strictly view-only.
An example counts only after its individual video page and footage have been inspected, including a source and an explicit observation date in the [CSV dataset](faceless-reels-dataset.csv).
Each entry separates footage observed directly from page or caption metadata and marks details that cannot be verified as unknown.
An image thumbnail, search snippet, caption, or creator profile alone cannot establish the first two seconds, pacing, audio, or whether the whole video is faceless.
The B14 duplicate audit established a URL and creative-ledger check against the CSV and prior exclusions before new viewing; account-prefixed and bare Reel links are compared by normalized platform source ID.
Cross-platform footage still needs direct visual comparison because URL matching alone cannot find reposts.
The prepublication audit now rejects any counted original URL or platform source ID found in the excluded-lead table, including links presented through public mirrors.
The 2026-11-05 owner-authorized source correction removed the Sweetgreen wrap video from the count because its original opens on visible presenters; the exclusion and observation remain in the historical ledger.
Instagram repost counts are retained in evidence notes, while the `shares` field is blank when an independently visible share count is unavailable; reposts are not interchangeable with shares.
The full CSV was checked for this metric mix-up, including older TikTok mirror shares and original TikTok share counters.
The CSV is written as UTF-8 with LF line endings through the existing Python standard-library `csv.DictWriter(..., lineterminator="\n")` workflow, preserving quoted fields and allowing the normal whitespace check to run without a cleanup rewrite.
The staged audit reads raw `git show` bytes to reject CRLF and bare carriage returns before publication; text-mode CSV parsing alone can silently normalize them.
Engagement is a public page snapshot on the access date, not evidence that a creative choice caused results.
Nutrition numbers stated by other creators are reported as their claims, not verified Fitsy estimates or venue-wide health claims.
Two owned research tabs lost browser attachment with a `Debugger unattached` tool message during B14; the researcher used the documented browser-troubleshooting guidance and new owned tabs to resume ordinary viewing.
This was a Chrome attachment incident, not an Instagram or TikTok challenge, captcha, action block, or license to change platform access routes.
No platform safety stop appeared in the B14-B16 pages inspected.
At 2026-11-05 03:36 UTC, TikTok displayed "Sorry, something wrong with the server, please try again." while the researcher viewed a Luna Grill original.
TikTok viewing stopped immediately under the instructed try-again safety rule; no refresh, alternate account, or alternate TikTok route was used afterward.
This was a visible server notice, not an identified captcha or rate limit.
The owned stopped TikTok tab 2090362390 was closed after the notice.
The older worker-created TikTok tab 2090362381 remains detached because a supported close attempt returned "Debugger unattached"; it was not used to resume TikTok viewing.
Instagram remained independently accessible and supplied the later B17 Reels.
The current capture entrypoint first checks normalized platform source IDs against counted and excluded links before opening a known candidate.
Before counting, the researcher checks account and brand aliases, restaurant and dish, hook, visual sequence, overlay, and caption against the creative ledger across both platforms.
Likely matches are compared with retained source-bound frames; after TikTok stopped, no new TikTok request is made.
A different URL, date, or counter is insufficient to prove a different creative.
A candidate with unresolved creative identity remains excluded, and the outcome is recorded in its evidence.
The owner-authorized Better Bowls correction retained one TikTok creative and moved the Instagram cross-post URL, counters, and frame comparison into that row notes without mixing platform metrics.
B19 applied this prescreen to four ON+ON Reels: their account and venue match but their openings and footage differ, with no matching retained TikTok creative.
Two Hummus Republic Instagram leads remain uncounted: the summer poolside edit matches the retained TikTok frames, and the 52g shawarma creative could not be distinguished from retained TikTok footage with sufficient confidence.
It then audits the same staged CSV and report for raw LF bytes, exclusion-ledger conflicts, repost/share semantics, total, gap, platform and LA counts, missingness, original-source ratio denominator, and the newest batch entry before publication.

### Historical anonymous public access log

The original 15-25 target and anonymous-only access rule were superseded by Dawit's 2026-11-04 issue comments; this subsection retains what the earlier worker actually saw.

| Date | Source and ordinary access attempted | Observed result | Treatment |
| --- | --- | --- | --- |
| 2026-11-04 | [CAVA TikTok post](https://www.tiktok.com/@cava/video/7584209134459964685) opened through public web fetch without login. | Fetch returned a cache miss; no footage was available there. | Used the [Urlebird public mirror](https://urlebird.com/video/save-this-for-your-next-post-gym-session-cava-macro-friendly-b-7584209134459964685/) for direct playback, page metadata, and engagement. |
| 2026-11-04 | [Second CAVA TikTok post](https://www.tiktok.com/@cava/video/7598677513803533599) opened through public web fetch without login. | Fetch returned a cache miss; no footage was available there. | Used its [Urlebird public mirror](https://urlebird.com/video/save-this-macro-friendly-bowl-for-your-next-gym-session-530-ca-7598677513803533599/) for direct playback, page metadata, and engagement. |
| 2026-11-04 | [Third CAVA TikTok post](https://www.tiktok.com/@cava/video/7644739997911797022) opened through public web fetch without login. | The fetch tool reported the URL inaccessible; no footage was available there. | Used its [Urlebird public mirror](https://urlebird.com/video/big-bulky-bowl-for-my-big-bulky-boy-7644739997911797022/) for direct playback, page metadata, and engagement. |
| 2026-11-04 | [Chipotle high-protein TikTok post](https://www.tiktok.com/@chipotle/video/7586779412733988151) opened through public web fetch without login. | Fetch returned a cache miss; no footage was available there. | Used its [Urlebird public mirror](https://urlebird.com/video/cant-go-wrong-try-our-brand-new-high-protein-menu-now-in-the-ch-7586779412733988151/) for direct playback, page metadata, and engagement. |
| 2026-11-04 | [Instagram Reel](https://www.instagram.com/reel/DEiZ6mzFsxh/) opened through public web fetch without login. | Fetch returned a cache miss; no footage was available there. | Excluded until an independently accessible video page can be checked. |
| 2026-11-04 | [Meta Ad Library MenuFit search](https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=MenuFit&search_type=keyword_unordered) opened through public web fetch without login. | HTTP 403 Forbidden. | No ad creative counted from this route. |
| 2026-11-04 | [MenuFit's public Meta Ad Library page](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&media_type=all&search_type=page&view_all_page_id=760146920523040) opened in an ordinary browser without selecting Facebook login. | The page loaded and showed about 440 active ads; the first screened food-order ads showed presenters, including a Panda Express ad inspected in playback. | People-led ads were excluded from the faceless count; no ad was counted from a thumbnail alone. |
| 2026-11-04 | The same public MenuFit advertiser was filtered to video ads across active and inactive status, sorted most recent, and screened through 21 additional previews and three detail cards without login. | The filtered page showed about 430 results; two restaurant-order detail cards opened on visible faces, while the played food-only card showed home preparation without a specific restaurant order. | This bounded public ad sample supplied no qualifying example; the entire library was not exhausted. |
| 2026-11-04 | [Sweetgreen TikTok post](https://www.tiktok.com/@sweetgreen/video/7655407233945177357) opened through public web fetch without login. | Public fetch could not access the original page. | Used the [Urlebird public mirror](https://urlebird.com/video/2026-is-the-year-of-fibermaxxing-7655407233945177357/) for direct video playback, page metadata, and engagement. |
| 2026-11-04 | [Sweetgreen protein montage TikTok post](https://www.tiktok.com/@sweetgreen/video/7572235699710119182) opened through public web fetch without login. | Fetch returned a cache miss; no footage was available there. | Used the [Urlebird public mirror](https://urlebird.com/video/my-kind-of-protein-shake-7572235699710119182/) for direct video playback, page metadata, and engagement. |
| 2026-11-04 | [TTAnon MenuFit-partner page](https://ttanon.com/%40macroswithem) inspected through an ordinary public browser. | Cloudflare security verification prevented footage inspection. | Treated caption and counters as discovery only, with no count or visual claims. |
| 2026-11-04 | [TTAnon LeanBites-partner Taco Bell post](https://ttanon.com/@evanfoodhacks/video/7685452987036142879) inspected through an ordinary public browser. | Page metadata and text were indexed, but Cloudflare security verification prevented video playback. | The swap, timing, and facelessness could not be confirmed; no LeanBites video was counted. |
| 2026-11-04 | [Subway low-calorie TikTok mirror](https://urlebird.com/video/470-calories-6-inch-subway-tips-order-all-the-veggies-u-want-7358298794926148895/) opened in an ordinary public browser. | The player said it could not play the media and remained black. | Kept as an unverified discovery lead, not a counted example. |
| 2026-11-04 | [Pictame LA vegan Reels discovery page](https://pictame.com/en/discover/hashtag/veganla) opened in an ordinary public browser and revisited, then through public web fetch. | Browser showed Cloudflare security verification on both visits; web fetch reported the page inaccessible. | No bot-check action was taken; search-indexed LA captions could not establish individual video footage or facelessness. |

The public mirror is unaffiliated with TikTok, and its displayed counters can change.
Mirror captions and playback can disagree, so a mirrored example counts only after its visible footage matches the named restaurant and creative claim.
The prior batch used no authenticated content, private API, proxy rotation, or bot-check bypass as research evidence.
The prior worker noticed an existing signed-in TikTok session during a media-type check and abandoned it under the then-current anonymous-only rule.
The current signed-in viewing authorization supersedes that restriction without changing the historical access record.
When a public source supplies only a caption or thumbnail, its discovery lead is excluded from the counted examples.
Several [official MenuFit public mirrors](https://urlebird.com/user/menufit.app/) played a single static graphic throughout and may represent TikTok photo posts rendered as video by the mirror; their original media type could not be confirmed through anonymous access, so none counts here.
The [Socialpruf Sweetgreen gallery](https://socialpruf.com/tiktok/sweetgreen) was also screened as a public fallback, but one salad-labeled card played an unrelated word quiz, so its gallery footage was excluded where caption and player could not be reconciled.

### Screened but excluded leads

| Public lead | Reason it does not count |
| --- | --- |
| [MenuFit partner Benji Xavier Chick-fil-A](https://urlebird.com/video/low-calorie-high-protein-chick-fil-a-order-ft-use-c0de-benji-f-7697378741944716574/) | Public mirror playback showed his face. |
| [Shay Click Chipotle high-protein menu](https://urlebird.com/video/okay-with-the-new-high-protein-menu-my-cookbook-is-out-now-link-7597919595894361375/) | The first visible frame is a talking head. |
| [MenuFit official restaurant swaps](https://urlebird.com/video/check-out-these-easy-meal-swaps-at-your-favorite-restaurants-7702938876935015693/) | The first frame shows two people; its "fat order" framing is also a copy pitfall. |
| [MenuFit official El Pollo Loco bowl](https://urlebird.com/video/this-el-pollo-loco-chicken-queso-bowl-turns-comfort-food-into-a-7704076656851373326/) | The public mirror played a static food graphic and original video versus photo status is unconfirmed. |
| [MenuFit official Wingstop order](https://urlebird.com/video/this-82g-protein-wingstop-order-is-an-absolute-classic-7702887667293359373/) | The public mirror played a static food image and original video versus photo status is unconfirmed. |
| [MenuFit official Jimmy John's unwich](https://urlebird.com/video/this-unwich-from-jimmy-johns-has-36g-of-protein-and-only-275-cal-7702842441316994335/) | The public mirror played a static food image and original video versus photo status is unconfirmed. |
| [MenuFit CAVA 52g bowl](https://urlebird.com/video/52g-of-protein-in-a-cava-bowl-tag-someone-who-needs-to-try-this-7702257438610820365/) | The same food photo persisted as the player advanced to 4.85 seconds; motion and original video status were unverified. |
| [MenuFit Panda Express order](https://urlebird.com/video/this-panda-express-order-is-a-must-try-7702991084086889759/) | The same food photo persisted as the player advanced to 7.23 seconds; motion and original video status were unverified. |
| [Zack's post-gym Miami restaurant visit](https://urlebird.com/video/post-workout-hunger-same-after-a-hard-grind-at-the-gym-i-need-f-7543060442311134495/) | Public mirror playback opens on the presenter's face. |
| [Sweetgreen protein-for-good clip](https://urlebird.com/video/serving-protein-for-good-7574199703294856503/) | A presenter's face appeared in public mirror playback by 3.57 seconds. |
| [Benji Xavier MenuFit Popeyes claim](https://urlebird.com/video/low-calorie-popeyes-hack-ft-c0de-benji-use-c0de-for-a-free-tria-7680315835260423455/) | The mirror page caption described a Popeyes order, but playback showed different Disney World footage; page metadata and footage could not be reconciled. |
| [Onbo Hub MenuFit social preview](https://onbo-hub.com/apps/menufit/story) | Its one freely linked social item is explicitly a TikTok photo post, and the remaining social examples require Pro access; neither supplies verified video footage. |
| [LeanBites-partner Taco Bell swap](https://ttanon.com/@evanfoodhacks/video/7685452987036142879) | Indexed text describes a calorie and protein comparison, but a Cloudflare check blocked footage; on-screen timing, motion, and facelessness remain unverified. |
| [Alex Gamble Subway calorie swap](https://urlebird.com/video/half-the-calories-more-protein-on-the-go-lunches-subway-editi-7281624231316638983/) | Public playback opened on the presenter's face. |
| [Victoria Mae Panda Express meals under 500 calories](https://urlebird.com/video/meals-under-500-calories-comment-down-which-place-i-should-do-ne-7629106560257608991/) | Public playback showed the creator's face within ten seconds. |
| [Victoria Mae Chick-fil-A lunch ideas](https://urlebird.com/video/chick-fil-a-low-calorie-lunch-ideas-save-for-when-you-go-to-n-7334794314159099166/) | The opening frame showed the creator's face. |
| [Tasty Shreds MenuFit Chick-fil-A meal prep](https://urlebird.com/video/lazy-chickfila-meal-prep-using-the-the-order-is-simple-and-come-7688156806991940878/) | The creator's face appeared by 1.2 seconds, despite the food-first thumbnail. |
| [Tasty Shreds MenuFit Arby's order](https://urlebird.com/video/arbys-steak-mac-bowl-fast-food-doesnt-have-to-wreck-your-macro-7690750741840973069/) | The opening frame showed the creator's face. |
| [Ian Jack MenuFit steakhouse comparison](https://www.snapchat.com/%40ianjackedeats/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYanNjc2tzdmNjAZ3XYOl6AZ3XWs7yAAAAAQ) | A creator-owned public Spotlight was playable without login, but the creator's face appeared, and no exact Reel or TikTok cross-post was verified. |
| [CAVA official Gym Bro Bowl](https://urlebird.com/video/time-to-make-those-gainz-heres-the-gym-bro-bowl-half-brown-rice-7689230048234097950/) | Public mirror playback opens on a CAVA employee's face. |
| [Blair Cooley CAVA protein and fiber order](https://urlebird.com/video/45g-protein-14g-fiber-is-one-of-my-fav-spots-to-grab-a-healthy-l-7687350241049333022/) | Public mirror playback opens on the dietitian's face. |
| [Socialpruf Sweetgreen salad card](https://socialpruf.com/tiktok/sweetgreen) | The card linked to an official Sweetgreen TikTok, but the gallery player showed an unrelated word quiz; footage attribution was not reliable enough to count. |
| [MenuFit Panda Express Meta ad](https://www.facebook.com/ads/library/?id=1183997977522853) | The ad presents a calorie and protein overlay, but a person's face and hair appear beside the tray in the opening frame. |
| [MenuFit Chick-fil-A Meta ad](https://www.facebook.com/ads/library/?id=1170741792303768) | A woman's eyes and face are visible behind the food container in the opening frame. |
| [MenuFit food-preparation Meta ad](https://www.facebook.com/ads/library/?id=2864133903960270) | Public playback showed a home food-preparation sequence and an app screen, without a specific restaurant dish or order. |
| [MenuFit partner Chipotle order](https://www.tiktok.com/@macroswithem/video/7702235650879212813) | The signed-in original TikTok opened on the creator's face, despite its restaurant macro caption. |
| [LeanBites partner Taco Bell swap](https://www.tiktok.com/@evanfoodhacks/video/7685452987036142879) | The signed-in original TikTok opened on the creator's face; earlier indexed text alone could not show this. |
| [Earlier Oishi low-carb sushi edit](https://www.tiktok.com/@oishisushiglendale/video/7595380791308291358) | It reuses the opening sushi close-up from the counted later Oishi post, but its subsequent footage shows a creator's face. It is excluded as a separate faceless example. |
| [LeanBites three fast-food cheat codes](https://www.tiktok.com/@leanbitesapp/video/7695810137289706782) | Original TikTok playback opens with a talking presenter over a restaurant-food collage. |
| [Hailey's Mendocino Farms salad](https://www.tiktok.com/@lastairbender222/video/7697362902994406687) | The original TikTok opens on the creator's face despite a restaurant-order caption. |
| [Oishi Sushi no-rice mukbang](https://www.tiktok.com/@oishisushiglendale/video/7575697462229208375) | The original TikTok opens on a creator presenting a no-rice roll to camera. |
| [LA two-spot clean-eating Reel](https://www.instagram.com/holistichealthlaur/reel/Dd7fSDYDsL3/) | The first Talo Organic food montage is faceless, but the second Parakeet Cafe sequence shows a diner's face eating. |
| [Low-calorie Mexican order Reel](https://www.instagram.com/kraftyoufitness/reel/DcJJJ0VxAI8/) | The original Instagram Reel opens on the presenter eating at a restaurant, despite a food-only search thumbnail. |
| [Hive seed-oil-free spot Reel](https://www.instagram.com/hivehealthyeats/reel/DbL2nRGhsXC/) | Food-only montage frames seed-oil avoidance as "cleanest" without a specific nutrition comparison; excluded as a broad health claim. |
| [Palms n' Patties smashburger Reel](https://www.instagram.com/laslaywithtracy/reel/De-D4gZyXhQ/) | Food-only burger and griddle shots call no seed oils "healthy" without a specific nutrition comparison; excluded as an unsupported health shortcut. |
| [Chipotle bodybuilder order mirror](https://www.youtube.com/watch?v=OsI8j_1bNaY) | The footage has a TikTok watermark, but no original TikTok post URL or creator-owned cross-post was verified. It remains supplemental creative evidence and is excluded from the 150-video count. |
| [The Hive Buddha Bowl](https://www.instagram.com/hivehealthyeats/reel/De94IaehBix/) | Food footage promotes a vegan restaurant bowl under a general wellness frame, without a specific swap, macro, or surprising nutrition comparison. |
| [California Fish Grill protein hack](https://www.tiktok.com/@derekeatsla/video/7641014055804685599) | The original TikTok opens on the presenter's face. |
| [Protein Shop 77g wrap](https://www.tiktok.com/@theproteinshop/video/7657914600058326285) | The original TikTok shows the restaurant presenter holding the wrap. |
| [Summit LA protein sources](https://www.tiktok.com/@summits.life/video/7629475502113246478) | The original TikTok opens on a staff presenter with a microphone. |
| [El Pollo Loco double protein bowl](https://www.tiktok.com/@mmorganjohnsonn/video/7699981027443363086) | The original TikTok opens on the creator's face. |
| [Jawny's Sherman Oaks protein bowls](https://www.tiktok.com/@jawnys__/video/7691876236607425806) | The original TikTok opens on a restaurant presenter holding two bowls, despite its detailed gram and calorie claims. |
| [Soul Delicious Tron Bowl](https://www.tiktok.com/@souldeliciousla/video/7681344544499191053) | The original TikTok opens on a restaurant presenter holding the bowl. |
| [Organico LA organic bowls](https://www.instagram.com/organico_la/reel/De7TU8WhpF9/) | Food-only footage claims fully organic ingredients, but the post has no specific macro, protein, or swap angle. |
| [Locale meal jars](https://www.instagram.com/create.with.michael/reel/DWW6aalAekH/) | The creator frames delivered meal prep, without a particular restaurant dish or order. |
| [Shaw Choice protein bowls](https://www.instagram.com/latinafoodiela/reel/DYTwHL8Ncti/) | The Reel shows moving restaurant bowl assembly, but the creator's face appears holding trays in the original playback. A food-only thumbnail and later close-ups would have missed that presenter. |
| [Pura Vida West Hollywood opening](https://www.instagram.com/sklifevox/reel/DZAvrzZhFoa/) | The inspected Reel promotes a broad clean-food venue opening without a specific dish, swap, or macro comparison. |
| [Fountain East Hollywood bowl](https://www.instagram.com/romsinsta/reel/DH7bo-jRtHu/) | The post calls the venue the healthiest in LA and mentions ingredient sourcing, but the inspected page does not tie its health claim to a specific order or nutrition comparison. |
| [CynCity Eats Burbank protein lunch](https://www.tiktok.com/@cyncityeats/video/7602127946836380942) | The original TikTok shows the creator eating to camera, despite a restaurant-specific high-protein caption. |
| [Sweetgreen Chicken Jalapeño Ranch wrap hack](https://www.tiktok.com/@sweetgreen/video/7686922325714898190) | The original TikTok shows food-only assembly, but the modification adds crunch and sauce without an observed nutrition swap or macro angle. |
| [Sweetgreen vegan Cali Chicken Club remix](https://www.tiktok.com/@sweetgreen/video/7698807701807189262) | The original TikTok describes a tofu-for-chicken vegan swap, but opens on two people presenting the wrap. |
| [Better Bowls 29g seasonal smoothie](https://www.tiktok.com/@betterbowls/video/7701090687277747486) | Hands-only footage and a caption state 29g protein and 290 calories for a smoothie, but the creative centers a drink rather than a restaurant dish or food order. |
| [Better Bowls Cinnamon Crunch Bowl](https://www.tiktok.com/@betterbowls/video/7698275583586798862) | The original TikTok shows a staff presenter holding and describing the high-protein bowl. |
| [Angie's 96g chicken bowl](https://www.tiktok.com/@eatangies/video/7592311517714992398) | The original video opens on a presenter holding the bowl in her car. |
| [Hummus Republic by Jean](https://www.tiktok.com/@jeanyu_/video/7699854146337262862) | A food-line opening looked faceless, but replay showed the creator eating on camera midway through its 13 seconds. |
| [Planta Protein Flex dishes](https://www.tiktok.com/@itsromab/video/7616414020710452494) | The original food-only opening cuts to a visible diner presenting a bowl. |
| [Protein Shop 100g combinations](https://www.tiktok.com/@theproteinshop/video/7704035638244314381) | The video starts with hands-only food preparation but later shows a presenter's face handing over the food. |
| [Summit 80g LA protein order](https://www.tiktok.com/@summits.life/video/7603909510033362190) | The original opens on a talking presenter; TikTok also labels it Promotional content. |
| [Boudin Bakery protein bowls](https://www.tiktok.com/@heatherr.eats/video/7657435294765010190) | A presenter appears beneath the restaurant sign in the opening frame. |
| [Flameo bowl launch](https://www.tiktok.com/@itsflameo/video/7704300358805228808) | The original opens on a restaurant employee speaking to camera. |
| [Luna Grill athlete meal](https://www.tiktok.com/@lunagrillofficial/video/7653197649520168223) | The opening food-and-sign shot gives way to an athlete and employee with visible faces. |
| [Better Bowls cinnamon yogurt](https://www.tiktok.com/@betterbowls/video/7698275583586798862) | A staff presenter faces the camera at the start, despite the high-protein bowl caption. |
| [Better Bowls weighed smoothie base](https://www.tiktok.com/@betterbowls/video/7691753226189753613) | This B13 row was removed after independent review found that it centers drink-base preparation, consistent with the report's exclusion of a separate protein smoothie. |
| [Sweetfin West Third invited visit](https://www.tiktok.com/@bychristinaphung/video/7597243077215931678) | This B13 row was removed after replay found the creator's face late in the food-first video. Its invitation disclosure remains useful as source-audit history. |
| [California Fish Grill 56g creator review](https://www.tiktok.com/@awtran/video/7696537228759108895) | The food-only opening gives way to the creator's face later in the original playback. |
| [Sweetgreen Power Max official video](https://www.tiktok.com/@sweetgreen/video/7574067725023202573) | The official video opens on a person eating at a desk. |
| [MenuFit Blaze Pizza partner](https://www.tiktok.com/@tastyshreds/video/7695868396780522766) | The original opens on the creator's face; a food-first public mirror lead would have been insufficient. |
| [Protein Shop 100g meal combinations Reel](https://www.instagram.com/theproteinshopnyc/reel/DfSsFhONvtN/) | A B18 provisional row was removed before publication: sampled food shots did not establish whole-video facelessness or a distinct creative identity from the earlier excluded Protein Shop 100g combinations TikTok. |

### Coverage achieved and remaining gap

106 distinct video identities qualify toward the expanded target: 70 TikToks and 36 Instagram Reels.
Seven creator-owned YouTube Shorts and one watermarked YouTube mirror without a verified original TikTok URL remain supplemental and do not fill the Reel/TikTok target.
At least 44 more qualifying Reel or TikTok videos are needed to meet the current lower bound.
All six official TikTok mirrors were watched through their public players; the watermarked mirror and the YouTube Shorts were checked at sampled timestamps, with unseen frames explicitly left unknown.
Sixty-two counted videos are LA-focused; other examples broaden restaurant and geographic coverage, but no inspected MenuFit creative, LeanBites creative, or Meta ad has yet met the criteria.
Directly inspected MenuFit and LeanBites partner TikToks opened on faces, while screened MenuFit ads and several other creator clips also showed faces.
The earlier anonymous public pass checked individual posts and indexes for Just Salad, Mendocino Farms, Tender Greens, Flower Child, Chopt, Chopped Leaf, LA food accounts, and seven YouTube creators without verifying another qualifying Reel or TikTok through those routes.
The later signed-in Just Salad Hero Wrap is separately counted in B14 after original-page footage inspection.
After TikTok's B17 server notice, the current route is slow-paced, signed-in, view-only inspection of Instagram public creatives in Dawit's existing Chrome session, plus analysis of the already assessed public TikTok Creative Center and Meta Ad Library.
Challenges, captchas, try-again-later notices, action blocks, private APIs, and unverified captions cannot close the evidence gap.

### Expanded research batches and data coverage

| Batch | Source and observed result | Counted qualifying examples | Remaining to 150 |
| --- | --- | ---: | ---: |
| B0, prior public pass, audited now | The prior pass called seven videos TikTok-origin. This audit retains six with original post URLs and inspected mirror footage; seven YouTube-only Shorts and one watermarked mirror without a verified original URL remain supplemental. | 6 | 144 |
| B1, 2026-11-04 signed-in Chrome | Instagram loaded as @fitsy.lyfe, but the first inspected Sweetgreen Reel showed a presenter and was excluded. CAVA's Instagram profile displayed about 334K followers. Original CAVA TikTok playback loaded; its profile displayed about 183.3K followers, and the original post displayed a dated caption plus like, comment, favorite, and share counters. The directly inspected MenuFit account URL returned "Couldn't find this account." | 0 new | 144 |
| B2, 2026-11-04 signed-in Chrome | Five LA TikTok originals passed sampled footage inspection: Pacific Catch Santa Monica, two The Hive Santa Monica creatives, The Window grain bowl, and Summit protein plate. Presenter-led candidates were excluded. | 5 new | 139 |
| B3, 2026-11-04 signed-in Chrome | Two LA Instagram Reels passed sampled footage inspection: Faregrounds Beverly Hills breakfast burrito and Sweetfin Innovation Kitchen bowls. A general list of healthy LA restaurants was screened but excluded from the count because it did not analyze a specific dish or swap. | 2 new | 137 |
| B4, 2026-11-04 same-profile view check | The original TikTok profile grids linked the exact Naomi, Kathy, and Summit post URLs to visible view counts. The original direct-post pages alone had not exposed those counts. | 0 new; 3 rows enriched | 137 |
| B5, 2026-11-04 signed-in Chrome | A hosted The Hive Instagram Reel, Oishi Sushi Glendale's low-carb TikTok, and a CAVA macro-order Instagram Reel passed footage screening. The earlier Oishi clip with a reused opening was excluded after its presenter appeared. | 3 new | 134 |
| B6, 2026-11-04 signed-in Chrome | A Talo Organic Venice bowl comparison and The Hive Chicken Athena protein Reel passed sampled Instagram footage inspection. TikTok restaurant-order search results repeatedly opened on presenters or photo slideshows; no additional TikTok video passed. | 2 new | 132 |
| B7, 2026-11-04 signed-in Chrome | A food-only The Girl and The Chicken Burbank Reel passed screening. A presenter-led MenuFit partner TikTok, an LA two-spot Reel with a visible diner face, and generic seed-oil or healthy-spot claims were excluded. | 1 new | 131 |
| B8, 2026-11-04 signed-in Chrome | A Luna Grill Medi Macro Bowl co-post showed food-only preparation and a 29g protein claim for the base bowl. The caption's double-chicken customization has no revised nutrition total. Presenter-led macro-order results were excluded. | 1 new | 130 |
| B9, 2026-11-04 signed-in Chrome | Two food-only The Hive bowl Reels showed restaurant-stated 38g and 70g protein claims. The original Hive grid also exposed exact post view counts for these and the earlier Chicken Athena Reel. Naomi's TikTok creative was found as an Instagram co-post and kept as one identity. | 2 new; 1 row enriched | 128 |
| B10, 2026-11-04 signed-in Chrome | Homegirl Cafe, six distinct Better Bowls Instagram Reels, a separate Better Bowls TikTok, Legacy Burgers, and Dialog Cafe passed sampled food-only footage review. Better Bowls' TikTok profile also showed captions matching several of its Instagram Reels, so those other uploads were not counted as new identities. Presenter-led Jawny's and Soul Delicious protein bowls were excluded. | 10 new | 118 |
| B11, 2026-11-04 signed-in Chrome | Ten distinct TikToks passed original-page footage inspection: two LA or LA-area creator bowls, a Michigan Sahara bowl, two Ohio Hummus Republic edits, a disclosed NYC paid partnership, an Atlanta Sweetgreen bowl, LOOK Cinemas bowls, and two Boston Happy Rice creatives. Later replay revealed faces in several food-first leads, which were excluded. | 10 new | 108 |
| B12, 2026-11-04 signed-in Chrome | Eight distinct TikTok originals passed sampled footage inspection: two Luna Grill edits, a Better Bowls West Hollywood POV, three California Fish Grill creator edits including one disclosed paid partnership, a California Fish Grill dinner review, and a Hummus Republic bowl swap. Four other uploads initially considered for this batch were removed after direct footage comparison showed the same creative already counted on the other platform. Face-led MenuFit partners and food-first videos with late faces were excluded. | 8 new | 100 |
| B13, 2026-11-04 signed-in Chrome, later audited | Ten TikToks were originally published in this batch. A later source audit found the creator's face in the Sweetfin West Third video, and independent review identified a smoothie-base preparation inconsistent with the food-only rule. Both rows were removed. The other eight cover LA protein bowls, a Sweetgreen order, and a non-LA Urbane Cafe add-on. | 8 retained | 92 |
| B14, 2026-11-04 signed-in Chrome | Eight additional TikToks passed individual-page footage inspection: two Urbane Cafe dishes, a Better Bowls workout edit, two Hummus Republic dishes, a Pacific Catch salmon menu edit, a Just Salad wrap, and an Eagle Rock steak bowl. Three apparent cross-platform duplicates and one weak venue-only angle were rejected; a Better Bowls yogurt build matching an already counted Instagram Reel was also removed. | 8 new | 84 |
| B15, 2026-11-04 signed-in Chrome | Ten additional TikToks passed individual-page footage inspection: four Hummus Republic franchise edits, two distinct Burbank Girl and The Chicken dishes, and one each from Carnivorous LA, Just Salad, Benny's Tacos, and Hummus Republic Delaware. A Delaware repost with the same lunch montage, two presenter-led search results, and a generic wellness montage were excluded. | 10 new | 74 |
| B16, 2026-11-04 signed-in Chrome | Nine TikToks and one Instagram Reel passed individual-page footage inspection: two distinct Girl and The Chicken falafel edits, two Merka Saltao bowl edits, two Sweetfin menu edits, three Smokin' Stove food edits, and one separate Merka Instagram order. A Merka cross-post, presenter-led reviews, photo posts, and broad wellness claims were excluded. | 10 new | 64 |
| B17, 2026-11-04 signed-in Chrome, later audited | Two TikToks and seven Instagram Reels remain after the owner-directed removal of a Sweetgreen wrap video that opens on presenters. California Fish Grill, Luna Grill, Fountain, Protein Shop, a Belfast vegan bowl, a Wisconsin hosted Hummus Republic lunch, a separate Hummus Republic Honey Harissa bowl, a West LA Moonbowls salad, and a West Covina protein bowl remain. TikTok viewing stopped after the 2026-11-05 03:36 UTC server notice; a Hive vegan-bowl lead, Kathy Hive cross-post, presenter-led clips, venue-only claims, and meal-prep services were excluded. | 9 retained | 55 |
| B18, 2026-11-04 signed-in Instagram, corrected | Seven distinct Reels remain: a Hummus Republic chicken bowl, Just Salad vegan choices, a Burbank bowl, a Health Nut lettuce wrap, and three West Covina protein bowls or waffles. The Better Bowls protein-goal Reel was later proved to be the same creative as a counted TikTok by retained frames and removed from this count. A Protein Shop combo and two older excluded leads also remained out. | 7 retained | 48 |
| B19, 2026-11-04 signed-in Instagram | Four distinct ON+ON restaurant-food Reels passed original-page footage review and cross-platform creative prescreen. Two Hummus Republic leads were inspected but not counted: the summer poolside sequence matches a retained TikTok, and separate identity of the 52g shawarma edit was unresolved against a retained TikTok. | 4 new | 44 |

The CSV holds the 106 counted video identities, original links, source links, observation batches, visible metrics, unknown fields, and source limitations.
Its commercial-context field records two TikToks labeled Paid partnership, two hosted Reels, one invitation-tagged Reel, brand-owned promotions, and creator posts with unknown paid amplification.
The hosted Reels, invitation, and two paid partnerships are retained as creative evidence but excluded from non-ad post performance comparisons when a ratio is available; absence of a disclosure in other posts is not proof of purely organic distribution.
The B1 CAVA post showed 2025-12-15, 17.7K likes, 175 comments, 4,617 favorites, and 2,001 shares on its original TikTok page; its approximate 3.3M view value remains a public-mirror snapshot.
The original TikTok profile displayed 183.3K followers on 2026-11-04, so its follower snapshot is current rather than a historical follower denominator for the post.
No view-to-follower ratio is interpreted from the older mixed-source, mixed-time mirror observations.
46 TikTok rows and 24 Instagram Reels now have original-profile view counts and current follower counts observed on the same day, each tied to the exact post tile.
Two of those TikToks carry a Paid partnership label, and one Instagram Reel marks a hosted meal, leaving **n = 67** original-post pairs in the non-ad normalized comparison: 44 TikToks and 23 Instagram Reels.
Three older CAVA TikToks have mirror view snapshots and current follower snapshots from a different source and time, so they remain outside this comparison.
The ratios use current follower snapshots against cumulative views on posts of different ages, so they cannot be read as reach at posting or a controlled comparison.
One account-level Reel window now supplies a bounded cadence observation, separate from the selected qualifying-video sample.
The latest-first [Luna Grill Reels grid](https://www.instagram.com/lunagrill/reels/) showed twelve consecutive tiles without a pinned marker, from the [November 3 offer Reel](https://www.instagram.com/lunagrill/reel/DfSdhcnxXSd/) through the [September 30 Forney opening Reel](https://www.instagram.com/lunagrill/reel/Dd7vmHWxs1u/) when inspected on 2026-11-04.
The year is inferred from the visible one-day and four-week age labels plus the observation date; the endpoints displayed month and day without a year.
Twelve Reels across the 35-day inclusive window equal 2.4 Reels per week, or eleven interpost gaps averaging 34/11 = 3.09 days.
This is one brand account and one recent Reels tab window, not a general posting recommendation; individual gap variability, Stories, and non-Reel posts were not measured.
The original historical access results below do not establish current platform access limits after the signed-in authorization.
TikTok Creative Center's public US Top Ads view showed a login-limited advertiser subset; a visible search for "protein" returned two non-restaurant ads, so zero were counted.
Meta Ad Library loaded MenuFit's advertiser page with about 500 active ads on this visit; two additional food-order previews showed presenters, so zero were counted from that screened subset.
Paid-ad previews are kept separate from organic reach analysis because those libraries do not expose comparable organic performance data.

| Field in the 106-row CSV | Observed | Unknown or source-limited | Interpretation now |
| --- | ---: | ---: | --- |
| Views | 76 | 30 | Six older public-mirror snapshots, forty-six original TikTok profile tiles, and twenty-four original Instagram Reel tiles bound to exact post URLs. |
| Follower count | 103 | 3 | Current Instagram or TikTok profile snapshots, not post-date denominators; some are rounded. |
| Likes and comments | 101 and 82 | 5 and 24 | New rows use original platform counts where visible; older rows include mirror observations. |
| Saves or favorites | 65 | 41 | Original TikToks exposed favorites; Instagram saves remain unknown. |
| Shares | 35 | 71 | Visible TikTok share counts are separate from Instagram repost observations; unavailable Instagram shares are blank or explicitly unknown. |
| Exact posted date | 16 | 90 | Sixteen originals displayed full dates; many others displayed month and day without year. |
| Length | 47 | 59 | All measured durations are TikTok player readings; Instagram durations remain unknown. |
| Verified audible voice or music | 0 | 106 | Track labels are recorded, but the listening evidence is insufficient. |

The forty-seven observed lengths range from 5 to 80 seconds with a median of 14 seconds; fifty-nine lengths are unknown.
The 80-second California Fish Grill review is a long food-only outlier; no measured Instagram duration supports a platform length comparison.
Across all 106 rows, hooks include order instruction, protein surprise, food assembly, social proof, menu launch, venue reveal, and offer framing; no single hook dominates this selected sample.
Thirty-five rows show a clear creator-stated numeric calorie or protein claim, two show numeric labels whose units or referents are unclear, and sixty-nine have no numeric calorie or protein figure verified in inspected frames or captions.
These categories describe what appears in the video or caption, not whether the nutrition estimate is accurate.
62 of 106 counted videos are LA-focused; 34 are elsewhere and 10 have an unknown location.
No Ad Library paid ad is included; the CSV separately marks two TikTok Paid partnership labels, two hosted Reels, and one invitation-tagged Reel.
These descriptive counts identify what this selected batch contains, not which creative choice caused more reach.
70 rows now have both current followers and views from the original post and account surfaces, but two disclosed Paid partnerships and one hosted Reel are excluded from the 67-row non-ad ratio pool.
Three older CAVA rows combine mirror views with current original-profile followers and remain outside that pool.

| LA original post tile and current profile count | Views | Current followers | Views / current follower | Observed angle |
| --- | ---: | ---: | ---: | --- |
| [The Hive by Naomi](https://www.tiktok.com/@naomisnoshes/video/7688912545826000158) | 438 | 1,167 | 0.38 | Surprise 65g protein bowl claim. |
| [The Hive by Kathy](https://www.tiktok.com/@lawithkathy/video/7675130994252352782) | 7,281 | 3,750 | 1.94 | Broad healthy-lunch discovery. |
| [Summit protein plate](https://www.tiktok.com/@summits.life/video/7619757946339183886) | 965 | 129 | 7.48 | Customizable protein plate. |
| [Oishi Sushi low-carb rolls](https://www.tiktok.com/@oishisushiglendale/video/7598811337388494111) | 3,297 | 50 | 65.94 | Food-only low-carb sushi roll close-ups. |
| [The Hive Chicken Athena bowl](https://www.instagram.com/hivehealthyeats/reel/Der3kWER4AR/) | 363 | 25,200 | 0.014 | Brand claim of 65g protein. |
| [The Hive Fresh Catch Bowl](https://www.instagram.com/hivehealthyeats/reel/DbtWB8KxfJS/) | 1,085 | 25,200 | 0.043 | Brand claim of 38g protein. |
| [The Hive Protein Power Bowl](https://www.instagram.com/hivehealthyeats/reel/DbBjwiWMb_U/) | 2,323 | 25,200 | 0.092 | Brand claim of 70g protein. |
| [Better Bowls yogurt build](https://www.instagram.com/betterbowls.la/reel/DdmjOnsiIz1/) | 2,974 | 776 | 3.83 | Hands-only protein yogurt bowl assembly. |
| [Better Bowls acai alternative](https://www.instagram.com/betterbowls.la/reel/DeUzSJGEw9V/) | 1,630 | 776 | 2.10 | Restaurant-stated 40g+ protein comparison. |
| [Better Bowls protein-goal bagel](https://www.instagram.com/betterbowls.la/reel/DeSNcH6D_qj/) | 408 | 776 | 0.53 | Bagel assembly for an errands breakfast. |
| [Better Bowls yogurt base](https://www.instagram.com/betterbowls.la/reel/De2Qj4MAdsA/) | 1,845 | 776 | 2.38 | Hand-mixed acai alternative. |
| [Better Bowls protein-bar swap](https://www.instagram.com/betterbowls.la/reel/DeAqoftDe83/) | 744 | 776 | 0.96 | Yogurt lunch versus a protein bar. |
| [Better Bowls Niagen Bowl](https://www.instagram.com/betterbowls.la/reel/DdunlGJlHzB/) | 392 | 776 | 0.51 | Brand claim of 45g protein with an unverified energy claim. |
| [Better Bowls protein-goal TikTok](https://www.tiktok.com/@betterbowls/video/7626915747305901343) | about 12,900 | 132 | about 97.7 | Empty-to-filled yogurt bowl reveal. |
| [Better Bowls 40g+ POV](https://www.tiktok.com/@betterbowls/video/7689275018944974110) | 990 | 132 | 7.50 | Separate yogurt-pour POV edit; brand claim lacks a dish-specific verified figure. |
| [Legacy Burgers teriyaki bowl](https://www.tiktok.com/@legacyburgersolym/video/7701127114052898062) | 1,067 | 489 | 2.18 | Grill-to-bowl restaurant protein option. |
| [Better Bowls by The Bougie Foodie](https://www.tiktok.com/@the_bougie_foodie/video/7634359903447993613) | 776 | 719 | 1.08 | West Hollywood protein-yogurt cafe recommendation. |
| [Better Bowls protein bagels](https://www.tiktok.com/@betterbowls/video/7616507505685941517) | 1,213 | 132 | 9.19 | Brand-stated bagel protein and fiber claims. |
| [Merka Saltao 55g bowl](https://www.tiktok.com/@merka.saltao/video/7695518156206525710) | 690 | 1,544 | 0.45 | Brand-stated protein grams over food assembly. |
| [Merka Saltao build-your-bowl](https://www.tiktok.com/@merka.saltao/video/7699590981829627149) | 618 | 1,544 | 0.40 | Customizable protein and side choices. |
| [Carnivorous LA protein bowls](https://www.tiktok.com/@carnivorous.la/video/7701099653097442590) | 54 | 230 | 0.23 | Eagle Rock brand bowl launch. |
| [Better Bowls workout yogurt](https://www.tiktok.com/@betterbowls/video/7691094257314041102) | 1,107 | 132 | 8.39 | Separate workout-framed edit of a protein-yogurt bowl. |
| [Carnivorous LA steak bowl](https://www.tiktok.com/@carnivorous.la/video/7698459563955162381) | about 15,300 | 230 | about 66.5 | Eagle Rock steak and fries reveal; views are rounded. |

Fourteen earlier LA rows in this table are TikTok originals and nine are Instagram Reels; four additional LA TikTok pairs appear in the B15 table below.
Repeated Better Bowls Reels share one 776-follower snapshot, while its TikTok account showed only 132 followers.
Thirteen earlier non-ad TikToks with original-post views and current follower counts provide a wider but still selected context; six additional non-LA or location-unknown TikTok pairs appear in B15.

| Other original TikTok post | Views | Current followers | Views / current follower | Context and interpretation limit |
| --- | ---: | ---: | ---: | --- |
| [Sahara Mediterranean protein bowl](https://www.tiktok.com/@saharahallroad/video/7600944752682470687) | about 302,000 | 346 | about 872.8 | Michigan brand post; the rounded view count and tiny current denominator create an extreme outlier, with paid amplification unknown. |
| [Hummus Republic summer bowls](https://www.tiktok.com/@hummusrepublicdelaware/video/7676929540400221453) | 151 | 62 | 2.44 | Ohio brand macro lineup; current account has only 62 followers. |
| [Hummus Republic 70% bowl](https://www.tiktok.com/@hummusrepublicdelaware/video/7676930080114838797) | 73 | 62 | 1.18 | Same brand and follower snapshot; its 70% customer claim is unverified. |
| [Sweetgreen Hot Honey Chicken by KP](https://www.tiktok.com/@theekalebp/video/7647596793546411277) | about 11,200 | about 13,900 | about 0.81 | Atlanta creator post with rounded numerator and denominator. |
| [Happy Rice bowls by Jas](https://www.tiktok.com/@jasfoodgram/video/7703593051096157454) | 918 | 2,477 | 0.37 | Boston creator's food-only launch video. |
| [Happy Rice brand warm bowls](https://www.tiktok.com/@happyricesushi/video/7703583251662703886) | 830 | 1,005 | 0.83 | Separate preparation creative from the same Boston restaurant. |
| [California Fish Grill review by Sae](https://www.tiktok.com/@saeieats/video/7703780013153193229) | 161 | 459 | 0.35 | Long food-only dinner review; rice-versus-salad preference is a personal choice, not a controlled swap outcome. |
| [Urbane Cafe Harissa sandwich](https://www.tiktok.com/@urbanecafe/video/7701795535266549006) | 1,133 | 1,233 | 0.92 | High-protein menu-name claim; filmed location unknown. |
| [Urbane Cafe protein bowl](https://www.tiktok.com/@urbanecafe/video/7640271224437853453) | 1,800 | 1,233 | 1.46 | Hands-only bowl and sauce pour; filmed location unknown. |
| [Hummus Republic 52g shawarma](https://www.tiktok.com/@hummusrepublic/video/7693569934135381256) | about 816,600 | 883 | about 924.8 | Jacksonville brand outlier; views rounded, paid amplification unknown. |
| [Hummus Republic pita nachos](https://www.tiktok.com/@hummusrepublic/video/7665389154125024520) | 1,512 | 883 | 1.71 | Isla Vista brand protein-packed claim without grams. |
| [Pacific Catch salmon bowl](https://www.tiktok.com/@pacificcatch/video/7690480677514415391) | 241 | 410 | 0.59 | California location only; supplement-replacement copy is a claim pitfall. |
| [Just Salad Hero Wrap](https://www.tiktok.com/@justsalad/video/7686197269376306446) | 1,080 | about 13,400 | about 0.08 | Brand lower-carb and higher-fiber claim without a stated baseline; rounded followers. |

The [VIVIBOWL creator partnership](https://www.tiktok.com/@2chenz/video/7703692919986736414) had 322 views and 1,838 current followers, or about 0.18 views per current follower.
The [California Fish Grill creator partnership](https://www.tiktok.com/@sarah.kaycee/video/7701863169433554190) had 856 views and 3,091 current followers, or about 0.28 views per current follower.
Their explicit Paid partnership labels keep both outside the non-ad comparison.
Jenz's LA Kebab Shop video and LOOK Cinemas' bowl launch lack exact-post view observations, so neither has a ratio.
Platform ratios, account sizes, and post ages should not be pooled into a single ranking.
Within the three Hive Reels, the 70g Protein Power Bowl has more views per current follower than the 65g Chicken Athena bowl, but post ages and presentation differ.
Within six Better Bowls Instagram Reels from the same current account, the yogurt-build clip has about 7.6 times the views of the Niagen Bowl clip, and the protein-goal bagel has about 14% of the build clip's views.
Their publish dates and topics differ, so this is relative underperformance within selected posts, not proof that Niagen or a bagel angle generally flops.
Within four retained Better Bowls TikTok originals against the same current 132-follower snapshot, the protein-goal reveal's approximate 12,900 views exceed the workout-framed bowl edit's 1,107 by about twelve times.
The posts differ in age, hook, and possible distribution, so this only identifies relative underperformance in the selected account sample.
Merka Saltao's two distinct bowl edits drew 690 and 618 exact tile views against the same current 1,544-follower snapshot; neither establishes a meaningful hook winner from such close observations.
Carnivorous LA's 54-view launch has a much lower ratio than its older 15.3K-view steak-bowl edit against the same current 230-follower snapshot.
Their different ages, edits, and unknown distribution make a universal flop label indefensible.
Within the selected TikToks, Hummus Republic's rounded 816.6K views against 883 current followers produce the highest ratio, followed by Sahara's rounded 302K against 346.
Both are brand posts with unknown paid amplification and unusually small current denominators, so neither is evidence of an organic creative winner.
None of those ratios establishes the distribution mechanism or predicts performance on a larger account.
The three counted Ohio Hummus Republic edits show 73, 151, and 183 views against the same current 62-follower snapshot, but their publication timing, subject, and possible distribution are not controlled.
The sample remains uneven in account, post age, distribution, and format and cannot establish a repeatable winner.
No causal claim follows from these ratios.
The [Naomi TikTok](https://www.tiktok.com/@naomisnoshes/video/7688912545826000158) also appears as an [Instagram co-post](https://www.instagram.com/naomisnoshes/reel/DdoyFWotDIz/) with the same opening bowl and 65g claim.
Its original Hive Instagram grid showed 840 views and its Reel showed 149 likes on the observation date, but the two uploads count as one creative identity and have different platform audiences and observation surfaces.

### New inspected Instagram and LA TikTok examples

| Original video | Opening, footage, and nutrition treatment | Public engagement snapshot on 2026-11-04 | Evidence limits |
| --- | --- | --- | --- |
| [Pacific Catch Santa Monica](https://www.tiktok.com/@losangelesgoodeats/video/7619405004020927774) | Venue-first sign and white location label lead to bowls, sushi, and dining-room cuts; caption frames the Feel Good 5 menu as health-conscious and names chicken and shrimp, without a gram claim. | 1,668 likes, 15 comments, 1,150 favorites, 697 shares; creator profile 18.7K followers. | 22 seconds; post views, exact year of displayed 3-20, audio content, and nutrition verification unknown. |
| [The Hive Chicken Athena bowl](https://www.tiktok.com/@naomisnoshes/video/7688912545826000158) | A bowl opens under "65 grams of protein?" white outlined text; food, burrito, açaí, and latte cuts follow. The 65g bowl and 62g burrito figures are creator claims. | 438 views, 23 likes, 0 comments, 8 favorites, 1 share; creator profile 1,167 followers. | Views came from the exact original profile tile; duration, exact year of displayed 9-23, audio content, and nutrition verification unknown. |
| [The Hive healthy lunch](https://www.tiktok.com/@lawithkathy/video/7675130994252352782) | Food platter and "HEALTH" opening, then burrito sauce and latte in small white captions; the caption names high-protein açaí without a verified gram total. | 7,281 views, 217 likes, 19 comments, 97 favorites, 42 shares; creator profile 3,750 followers. | Views came from the exact original profile tile; duration, exact year of displayed 8-21, audio content, and nutrition verification unknown. |
| [The Window grain bowl](https://www.tiktok.com/@moodfashionfood/video/7475123059637095710) | Bowl close-up and venue sign carry an affordable healthy-lunch claim; overlay lists five LA-area locations. Caption describes an $8 grain bowl with a $2.75 protein add-on. | 863 likes, 8 comments, 820 favorites, 329 shares; creator profile 10.4K followers. | Posted 2025-02-24; post views, duration, audio content, and nutrition verification unknown. |
| [Summit protein plate](https://www.tiktok.com/@summits.life/video/7619757946339183886) | Receipt, chicken bowl, then empty dish under a short white "unlimited protein" caption; a fleeting 180g/40g text lacks clear referents. | 965 views, 20 likes, 2 comments, 7 favorites, 5 shares; restaurant profile 129 followers. | Views came from the exact original profile tile; duration, exact year of displayed 3-21, audio content, and gram meaning unknown; "big back" wording is a copy pitfall. |
| [Oishi Sushi Glendale low-carb rolls](https://www.tiktok.com/@oishisushiglendale/video/7598811337388494111) | Close sushi-roll and dipping shots open the clip; restaurant address appears in small white text near the end. Caption recommends three protein-oriented low-carb rolls without a gram claim. | 3,297 views, 157 likes, 2 comments, 26 favorites, 13 shares; restaurant profile 50 followers. | Views came from the exact original profile tile; duration, exact year of displayed 1-23, audio content, and nutrition verification unknown. An earlier edit reuses its opening shot but later shows a face and is excluded. |

The six LA TikTok originals were sampled at opening, middle, and end; no presenter face appeared in inspected frames, but unsampled frames are not asserted as face-free.
These are selected examples with different account sizes and ages, so their raw engagement does not rank creative effectiveness.

### New Instagram examples in the current batch

| Original Reel | Opening, footage, and nutrition treatment | Public engagement snapshot on 2026-11-04 | Evidence limits |
| --- | --- | --- | --- |
| [Faregrounds Beverly Hills breakfast burrito](https://www.instagram.com/nate.eatz/reel/DKAHBRpJIVe/) | Storefront opens under a large black-on-white "LA's healthiest breakfast burrito" card; yellow outlined subtitles follow burrito close-ups and serving hands. The caption cites ingredient sourcing and no seed oils, which do not verify a nutrition outcome. | 5,430 likes; creator profile 373K followers. | Posted 2025-05-23; views, total comments, saves, shares, duration, audio content, and nutrition verification unknown. |
| [Sweetfin Innovation Kitchen bowls](https://www.instagram.com/theogglutenfree/reel/DVPcEzAAXPF/) | Menu board and bowl close-ups show the restaurant offering; caption calls the LA bowls high-protein and gluten-free friendly, without a gram figure in inspected frames. | 57 likes, 22 comments, 1 repost; creator profile 8,018 followers. | Exact year of displayed February 26, views, saves, shares, duration, audio content, and nutrition verification unknown. Repost count is not treated as share count. |
| [The Hive gluten-free choices](https://www.instagram.com/sayimafoodie.rd/reel/DWAt6oLicy-/) | A large italic "healthy gluten-free eats" overlay starts on The Hive sign, followed by shelf and bowl shots. Caption calls the bowls high-protein, recommends a shroom bowl, and discloses that the visit was hosted. | 83 likes, 31 comments; creator profile about 14.5K followers. | Exact year of displayed March 17, views, saves, shares, duration, audio content, and nutrition verification unknown; hosted context is separate from non-ad post performance. |
| [CAVA half-rice macro order](https://www.instagram.com/macro_habits/reel/Cnm4p6vDjsj/) | Small white serif "macro friendly cava order" text stays over storefront, ingredient assembly, and bowl shots. Caption claims 553 calories and 37g protein with half rice, versus 700 calories and 40g protein with full rice. | 474 likes; creator profile showed about 411K followers. | Posted 2023-01-19; views, total comments, saves, shares, duration, audio content, and nutrition verification unknown. |
| [Talo Organic Venice bowl](https://www.instagram.com/losangeles_eats/reel/DNkBzWyuiYA/) | A bold outlined "healthiest restaurant in Los Angeles?" question starts over a storefront crowd; food close-ups then call Talo a cleaner Chipotle/CAVA alternative and claim a quarter pound of meat per bowl. | About 28.6K likes; creator profile about 1.4M followers. | Posted 2025-08-19; views, precise engagement and follower totals, duration, audio content, and health/nutrition verification unknown. Incidental patrons are visible, with no presenter face in sampled food sequence. |
| [The Hive Chicken Athena bowl](https://www.instagram.com/hivehealthyeats/reel/Der3kWER4AR/) | A close bowl shot opens with "Chicken Athena said 65g protein, no problem" in bold white text, followed by gloved-hand ingredient assembly. The 65g figure is the restaurant's claim. | 363 views on the exact Reel grid tile; creator profile about 25.2K followers; the Reel displayed "liked by ... and others" without a total. | October 19 was visible without a year; likes, total comments, saves, shares, duration, audio content, and verified protein unknown. |
| [The Girl and The Chicken Burbank](https://www.instagram.com/daniellabraggtravels/reel/DWkbtKkAWHB/) | An overhead Mediterranean bowl opens under a small white "Healthy Never Tasted THIS Good" banner; food-only cuts show the Caesar wrap and beet side. The healthy framing is the creator's claim without numeric macros. | 198 likes; creator profile about 115K followers. | Posted 2026-03-31; views, comment total, saves, shares, duration, audible voice, and nutrition verification unknown. The restaurant is a collaborator, with commercial terms unknown. |
| [Luna Grill Medi Macro Bowl](https://www.instagram.com/shef.chelle/reel/DUcBeSdj6mB/) | A large yellow-and-white serif bowl reveal leads to sauce, ingredient, and gyro close-ups. Green-check overlays claim 29g protein and 11g fiber for the base bowl; the double-chicken customization lacks revised numbers. | 114 likes; creator profile showed 5,601 followers. | February 6 was visible without a year; views, comment total, saves, shares, duration, audible voice, and customized macros unknown. Mission Valley visit is outside LA; restaurant co-post terms unknown. |
| [The Hive Fresh Catch Bowl](https://www.instagram.com/hivehealthyeats/reel/DbtWB8KxfJS/) | A black-outlined uppercase "vision for this bowl" question opens on an empty plate; moving food footage builds to salmon, rice, avocado, and greens. The restaurant caption claims 38g protein. | 1,085 views on the exact Reel grid tile; profile about 25.2K followers. | August 6 was visible without a year; likes, comments, saves, shares, duration, audio content, and protein verification unknown. |
| [The Hive Protein Power Bowl](https://www.instagram.com/hivehealthyeats/reel/DbBjwiWMb_U/) | A close egg, avocado, edamame, and chicken bowl starts with "protein goals" copy; a later bold caption reads "one bowl, 70g of protein, done." The figure is the restaurant's claim. | 2,323 views on the exact Reel grid tile; profile about 25.2K followers. | July 20 was visible without a year; likes, comments, saves, shares, duration, audio content, and protein verification unknown. |

All ten Reels were sampled across their food sequences in the signed-in Instagram view; no presenter face appeared in inspected frames, although the Talo opening shows incidental patrons.

### B10 LA restaurant Reel and TikTok examples

| Original video | Inspected opening, nutrition treatment, and CTA | Public snapshot on 2026-11-04 | Limits |
| --- | --- | --- | --- |
| [Homegirl Cafe protein bowl](https://www.instagram.com/homegirlcafe/reel/DYh6lTQyhMB/) | A moving bowl close-up introduces a new Protein Bowl in small white text; caption lists eggs, potatoes, avocado, vegetables, beans, and protein choice. | 198 likes; profile about 60.6K followers. | May 19 appeared without year; views, duration, saves, and exact macros unknown. |
| [Better Bowls yogurt build](https://www.instagram.com/betterbowls.la/reel/DdmjOnsiIz1/) | Gloved hands add berries to blue protein yogurt under a centered build-with-us line; caption identifies protein yogurt and toppings. | 2,974 exact tile views, 31 likes; profile 776 followers. | September 22 appeared without year; grams, duration, comments total, and saves unknown. |
| [Better Bowls acai comparison](https://www.instagram.com/betterbowls.la/reel/DeUzSJGEw9V/) | Moving yogurt assembly and small subtitles accompany a caption claiming 40g+ protein versus a typical acai bowl under 10g; visit the WeHo cafe. | 1,630 exact tile views, 31 likes; profile 776 followers. | October 10 appeared without year; the comparison is a restaurant claim and is not verified. |
| [Better Bowls protein-goal bagel](https://www.instagram.com/betterbowls.la/reel/DeSNcH6D_qj/) | Hands cut a bagel under "how i hit my fiber and protein goal in between errands" text, then add breakfast toppings. | 408 exact tile views, 10 likes; profile 776 followers. | October 9 appeared without year; no protein grams or duration were visible. |
| [Better Bowls yogurt base](https://www.instagram.com/betterbowls.la/reel/De2Qj4MAdsA/) | Moving bowl and behind-counter preparation show a protein-yogurt alternative to acai; caption invites a visit. | 1,845 exact tile views, 21 likes; profile 776 followers. | October 23 appeared without year; no numeric nutrition total or duration was observed. |
| [Better Bowls lunch versus protein bar](https://www.instagram.com/betterbowls.la/reel/DeAqoftDe83/) | Gloved hands whisk yogurt under "real lunch, not another sad protein bar" text; caption says macros are weighed and invites ordering ahead. | 744 exact tile views, 12 likes; profile 776 followers. | October 2 appeared without year; the macro values themselves were not shown. |
| [Better Bowls Niagen Bowl](https://www.instagram.com/betterbowls.la/reel/DdunlGJlHzB/) | Moving food shot opens with "Our Niagen Bowl" and restaurant-stated 45g protein plus 300mg niagen; caption points to the menu. | 392 exact tile views, 5 likes; profile 776 followers. | September 25 appeared without year; nutrient and cellular-energy claims were not verified and should not be copied. |
| [Better Bowls protein-goal TikTok](https://www.tiktok.com/@betterbowls/video/7626915747305901343) | An empty bowl under a room-vision question becomes a filled yogurt bowl; caption asks if the viewer hit a protein goal. | About 12.9K tile views, 2,007 likes, 4 comments, 30 favorites; TikTok profile 132 followers. | April 9 appeared without year; duration, shares, and grams unknown. This is separate from the six Instagram openings above. |
| [Legacy Burgers teriyaki protein bowl](https://www.tiktok.com/@legacyburgersolym/video/7701127114052898062) | Grill footage under a large customer-order question cuts to rice and vegetables in a bowl; caption positions it as a protein bowl and asks for a visit. | 1,067 exact tile views, 24 likes, 0 comments, 1 favorite; profile 489 followers. | October 26 appeared without year; 21-second player; precise protein and paid distribution unknown. |
| [Dialog Cafe protein bowl](https://www.tiktok.com/@debby_rasson/video/7583219447037529374) | Food plate with eggs and greens fills the short clip; caption calls the Dialog bowl a repeated protein-bowl choice. A diner torso and hands appear without a face in sampled frames. | 87 likes, 0 comments, 16 favorites, 15 shares; profile 1,855 followers. | Posted 2025-12-12; 10-second player; views and numeric macros unknown. |

These ten originals were inspected at their individual pages in signed-in Chrome; no presenter face appeared in sampled footage, and unsampled frames remain unverified.
The Better Bowls TikTok profile also showed captions corresponding to several Instagram entries; later direct footage comparison verified three exact cross-post identities, documented in B12 below.
The six Better Bowls Instagram rows use one current profile count and are an account cluster, not six independent accounts.

### B11 original TikTok examples

| Original video | Inspected food footage, hook, and nutrition treatment | Public snapshot on 2026-11-04 | Evidence limits and commercial context |
| --- | --- | --- | --- |
| [Better Bowls by The Bougie Foodie](https://www.tiktok.com/@the_bougie_foodie/video/7634359903447993613) | West Hollywood venue and yogurt bowl cuts carry a large white endorsement; the caption calls the cafe protein-focused without a gram total. | 776 views, 6 likes, 2 comments, 2 favorites, 1 share; creator profile 719 followers. | 29 seconds; April 29 lacked year; staff member briefly incidental in background; sponsorship not disclosed. |
| [Sahara Mediterranean protein bowl](https://www.tiktok.com/@saharahallroad/video/7600944752682470687) | Food-only bowl montage starts under the brand wordmark; caption calls it protein-packed without numeric macros. | Rounded 302K views, 1,024 likes, 9 comments, 149 favorites, 97 shares; profile 346 followers. | 18 seconds; January 29 lacked year; paid distribution and nutrition verification unknown; tiny follower denominator. |
| [Hummus Republic summer bowls](https://www.tiktok.com/@hummusrepublicdelaware/video/7676929540400221453) | Moving poolside lineup labels four bowls with restaurant-stated 33-46g protein in white text. | 151 views, 1 like, 0 comments, 0 favorites; profile 62 followers. | August 28 lacked year; duration and shares unknown; brand-owned Ohio post. |
| [Hummus Republic 70% bowl](https://www.tiktok.com/@hummusrepublicdelaware/video/7676930080114838797) | Large white "70% of our customers order this" claim opens on chicken, then hands assemble a bowl under "FRESH." | 73 views, 2 likes, 0 comments, 0 favorites; profile 62 followers. | August 30 lacked year; the 70% claim, duration, and shares are unverified; brand-owned Ohio post. |
| [The Kebab Shop by Jen Z](https://www.tiktok.com/@jenz_losangeles/video/7351839397290986798) | El Segundo food line, kebab tray, and steak bowl appear under small white myth-busting subtitles; caption claims 42g protein and under 500 calories. | 1,631 likes, 9 comments, 557 favorites, 225 shares; creator profile rounded 177.8K followers. | Posted 2024-03-29; exact views and duration unknown; no presenter face in sampled replay; sponsorship not disclosed. |
| [VIVIBOWL by Henry](https://www.tiktok.com/@2chenz/video/7703692919986736414) | Restaurant sign and hands-only bowl assembly lead to three 35-43g protein claims in caption and closing food close-ups. | 322 views, 13 likes, 1 comment, 6 favorites, 2 shares; creator profile 1,838 followers. | TikTok labels this Paid partnership; 2d ago lacked an absolute timestamp; excluded from non-ad performance comparisons. |
| [Sweetgreen Hot Honey Chicken by KP](https://www.tiktok.com/@theekalebp/video/7647596793546411277) | Hand places sauce beside a close-up Atlanta bowl; caption calls it high-protein without grams. | Rounded 11.2K views, 222 likes, 11 comments, 53 favorites, 67 shares; profile rounded 13.9K followers. | June 4 lacked year; precise duration and nutrition unknown; sponsorship not disclosed. |
| [LOOK Cinemas Power Protein Bowls](https://www.tiktok.com/@look_cinemas/video/7642033713525706015) | Overhead five-bowl reveal and food-only table cuts announce a new menu; caption claims up to 41g protein without naming an individual bowl's total. | 9 likes, 1 comment, 2 favorites, 0 shares; profile 1,475 followers. | May 20 lacked year; views, duration, exact location, and paid distribution unknown. |
| [Happy Rice bowls by Jas](https://www.tiktok.com/@jasfoodgram/video/7703593051096157454) | Three Boston sushi bowls open under a white high-protein line, followed by fish close-ups; caption says menu nutrition facts exist, but shows no exact grams. | 918 views, 39 likes, 2 comments, 2 favorites; creator profile 2,477 followers. | 2d ago lacked an absolute timestamp; duration, shares, menu nutrition, and sponsorship unknown. |
| [Happy Rice brand warm bowls](https://www.tiktok.com/@happyricesushi/video/7703583251662703886) | Cod preparation opens under "BOSTON SEAPORT warm bowls are here" and cuts to food; caption claims 53g protein for cod and 50g for salmon. | 830 views, 26 likes, 1 comment, 2 favorites; brand profile 1,005 followers. | 2d ago lacked an absolute timestamp; duration, shares, verified macros, and paid distribution unknown; distinct filming from Jas's post. |

These ten originals were inspected in signed-in Chrome, with later replay for short-list candidates that initially appeared food-only.
Presenter-led LA, Boudin, Planta, Protein Shop, and MenuFit or LeanBites-tagged candidates were excluded rather than counted from food thumbnails or macro captions.
The new batch broadens platform and restaurant coverage but does not establish a reliable winner, a universal "flop" threshold, or a cadence pattern.

### B12 original TikTok examples and cross-post audit

| Original video | Inspected hook and creative treatment | Public snapshot on 2026-11-04 | Evidence and comparison limit |
| --- | --- | --- | --- |
| [Luna Grill Medi Macro Bowl](https://www.tiktok.com/@lunagrillofficial/video/7602334659317468447) | Empty-bowl and serving-line assembly; caption claims 29g protein, 11g fiber, and 840 calories for the base bowl. | 26 likes, 1 comment, 6 favorites, 6 shares; 1,117 current followers. | Irvine location; February 2 lacked year; views, duration, nutrition verification, and paid distribution unknown. |
| [Luna Grill 81g plate](https://www.tiktok.com/@lunagrillofficial/video/7465038045973187886) | Plate-only protein hack uses an 81g overlay and extra-kabob caption. | 37 likes, 2 comments, 16 favorites, 8 shares; 1,117 current followers. | Posted 2025-01-28; views, duration, serving verification, and paid distribution unknown. |
| [Better Bowls 40g+ POV](https://www.tiktok.com/@betterbowls/video/7689275018944974110) | Yogurt pour and counter shots carry a 40g+ menu claim. | 990 exact tile views, 64 likes, 0 comments, 4 favorites, 1 share; 132 current followers. | West Hollywood; 15 seconds; September 24 lacked year; dish-specific grams and paid distribution unknown. |
| [California Fish Grill by Sarah](https://www.tiktok.com/@sarah.kaycee/video/7701863169433554190) | Food-and-drink close-up starts a 14-second bowl edit; caption claims 56g protein. | 856 exact tile views, 52 likes, 4 comments, 7 favorites, 12 shares; 3,091 current followers. | Long Beach; labeled Paid partnership; exclude from non-ad ratios; exact date, nutrition verification, and paid reach unknown. |
| [California Fish Grill by Sae](https://www.tiktok.com/@saeieats/video/7703780013153193229) | Takeout-box opening leads to an 80-second food-only review and a personal rice-for-salad preference. | 161 exact tile views, 7 likes, 0 comments, 1 favorite, 0 shares; 459 current followers. | Location and exact date unknown; no numeric macros or sponsorship disclosure verified. |
| [California Fish Grill by Angela](https://www.tiktok.com/@angela.xu/video/7698775481474125087) | Nine-second bowl montage and offer text claim 56g protein. | 37 likes, 0 comments, 9 favorites, 3 shares; about 18.9K current followers. | Irvine; views, exact date, nutrition verification, and commercial terms unknown. |
| [California Fish Grill by Dhaorll](https://www.tiktok.com/@dhaorll/video/7692106361575951646) | Twelve-second tray and restaurant-graphic edit repeats the 56g protein offer. | 1,011 likes, 9 comments, 393 favorites, 526 shares; 1,051 current followers. | Fountain Valley; exact views, date, nutrition verification, and commercial terms unknown. Engagement alone does not establish paid reach. |
| [Hummus Republic bowl swap](https://www.tiktok.com/@hummusrepublic/video/7662416526317817096) | Gloved-hand assembly accompanies a McDonald's comparison and protein-bowl caption. | 9 likes, 0 comments, 1 favorite, 5 shares; 883 current followers. | Jacksonville; 13 seconds; views, exact date, numerical nutrition, audible mix, and paid distribution unknown. The swap is a creative claim, not a verified nutritional comparison. |

Direct visual comparison found that [Kathy's Instagram Hive upload](https://www.instagram.com/lawithkathy/reel/DcUylyahWY2/) repeats the counted [TikTok original](https://www.tiktok.com/@lawithkathy/video/7675130994252352782), so the two uploads retain one creative identity.
Three Better Bowls TikToks also repeated already counted Instagram edits: [Episode 2](https://www.tiktok.com/@betterbowls/video/7699939993917099278) matched the [Instagram yogurt-base Reel](https://www.instagram.com/betterbowls.la/reel/De2Qj4MAdsA/), [Episode 1](https://www.tiktok.com/@betterbowls/video/7689568928162434317) matched the [Instagram açaí comparison](https://www.instagram.com/betterbowls.la/reel/DeUzSJGEw9V/), and the [bagel TikTok](https://www.tiktok.com/@betterbowls/video/7695069046982577422) matched the [Instagram bagel Reel](https://www.instagram.com/betterbowls.la/reel/DeSNcH6D_qj/).
The duplicate uploads are provenance for the retained CSV rows, not four additional qualifying examples.
The separate Better Bowls 40g+ POV has a different opening, sequence, and call to action even though the account reuses some yogurt b-roll.

### B13 protein orders and LA bowls

| Original video | Inspected hook and creative treatment | Public snapshot on 2026-11-04 | Evidence and comparison limit |
| --- | --- | --- | --- |
| [Sweetgreen low-cost order by Shinny](https://www.tiktok.com/@shinnyyy2.0/video/7595006443485498655) | Storefront and serving-line footage gives a high-protein, lower-cost order; creator quotes $8.05 without a gram figure. | 843 likes, 4 comments, 361 favorites, 83 shares; current profile 77.3K followers. | 61 seconds; views, post year, numeric nutrition, and commercial terms unknown; an incidental staff face appears briefly, with no presenter to camera. |
| [Better Bowls protein bagels](https://www.tiktok.com/@betterbowls/video/7616507505685941517) | Food-only bagel and green-drink cuts; caption claims 14g and 11g protein for two named bagels and unusually high fiber values. | 1,213 exact tile views, 84 likes, 2 comments, 2 favorites, 1 share; current profile 132 followers. | 8 seconds; post year and nutrient verification unknown; distinct from its Instagram cinnamon-banana bagel edit. |
| [Superba Hollywood grain bowl](https://www.tiktok.com/@sophiesalmore/video/7692263072274140447) | Plate and salmon close-ups under a wholesome-lunch line; caption states added protein but gives no grams. | 274 likes, 25 comments, 164 favorites, 2 shares; current profile 7,410 followers. | 10 seconds; exact views, post year, nutrition, and commercial terms unknown. |
| [Urbane Cafe Pasadena fish bowls](https://www.tiktok.com/@evwonton/video/7670787686059363598) | Close plated salmon and ahi bowls open a five-second edit; caption calls them healthy and quotes $15 and $14. | 15 likes, 7 comments, 0 favorites; current profile 281 followers. | Exact views, shares, post year, and health validation unknown; the quoted prices are creator observations. |
| [Merka Saltao 55g bowl](https://www.tiktok.com/@merka.saltao/video/7695518156206525710) | Gloved-hand assembly and white ingredient callouts lead to a $13.60, 55g-protein claim. | 690 exact tile views, 28 likes, 2 comments, 2 favorites; current profile 1,544 followers. | 17 seconds; brand-stated grams and price are unverified; shares, post year, and paid reach unknown. |
| [Merka Saltao build-your-bowl](https://www.tiktok.com/@merka.saltao/video/7699590981829627149) | Two plated bowls and quinoa, bean, and chicken close-ups explain choosing a protein and sides. | 618 exact tile views, 18 likes, 0 comments, 0 favorites; current profile 1,544 followers. | 14 seconds; shares, post year, nutrition, and paid reach unknown; separate creative footage from the 55g edit. |
| [Carnivorous LA protein bowls](https://www.tiktok.com/@carnivorous.la/video/7701099653097442590) | Plated steak, egg, rice, and other meat bowls introduce a new Eagle Rock protein-bowl choice. | 54 exact tile views, 6 likes, 0 comments, 1 favorite, 2 shares; current profile 230 followers. | 14 seconds; about one week old at inspection; no numeric macros, verified health outcome, or paid reach data. |
| [Urbane Cafe double-chicken add-on](https://www.tiktok.com/@urbanecafe/video/7657265288454491405) | A handheld bowl and lunch-goal caption support a $2 extra-chicken option that the brand says reaches 70g protein. | 54 likes, 0 comments, 0 favorites; current profile 1,233 followers. | 8 seconds; no exact views or venue location; post year, shares, nutrition verification, and paid reach unknown. |

The eight retained B13 videos were screened through their original signed-in pages and sampled food footage, with exact view counts taken only from matching original profile tiles.
The original B13 publication included Christina's Sweetfin video and a Better Bowls smoothie-base edit; the later face audit and independent drink-rule review remove both from the count and keep the corrections visible.
The [Hive Buddha Bowl Reel](https://www.instagram.com/hivehealthyeats/reel/De94IaehBix/) was initially added, then removed after a consistency audit found that its general wellness framing did not meet the report's specific nutrition-angle rule.
Food-first Merka Saltao, SHAW, Sweetgreen, and other candidates with later presenter faces remain excluded, as do photo posts and cross-platform duplicate edits.

### B14 restaurant-protein edits and cross-post corrections

| Original video | Inspected hook and creative treatment | Public snapshot on 2026-11-04 | Evidence and comparison limit |
| --- | --- | --- | --- |
| [Urbane Cafe Harissa Chicken Sandwich](https://www.tiktok.com/@urbanecafe/video/7701795535266549006) | Kiosk and hands-only sandwich footage use the new high-protein menu item as the hook. | 1,133 exact tile views, 50 likes, 4 comments, 1 favorite; current brand profile 1,233 followers. | Dish grams, filmed location, date, duration, audio content, shares, and paid reach unknown. |
| [Urbane Cafe protein bowl](https://www.tiktok.com/@urbanecafe/video/7640271224437853453) | Eight-second bowl and green-sauce pour present a separate high-protein dish. | 1,800 exact tile views, 31 likes, 0 comments, 2 favorites; current brand profile 1,233 followers. | No numeric macros, filmed location, exact date, audible content, shares, or paid reach verified. |
| [Better Bowls workout yogurt](https://www.tiktok.com/@betterbowls/video/7691094257314041102) | Fruit bowls lead into gloved-hand yogurt prep under a small white workout cue. | 1,107 exact tile views, 41 likes, 0 comments, 1 favorite; current profile 132 followers. | Post year, duration, numeric macros, shares, audio content, and paid reach unknown; preparation b-roll may be reused. |
| [Hummus Republic 52g shawarma](https://www.tiktok.com/@hummusrepublic/video/7693569934135381256) | Bold white 52g text over shawarma leads to fresh-greens assembly. | Rounded 816.6K tile views, 394 likes, 4 comments, 42 favorites; current profile 883 followers. | Jacksonville; restaurant-stated grams unverified, and the apparent reach outlier has unknown paid distribution. |
| [Hummus Republic pita nachos](https://www.tiktok.com/@hummusrepublic/video/7665389154125024520) | Pita-chip introduction leads to gloved-hand topping assembly under a protein-packed caption. | 1,512 exact tile views, 83 likes, 0 comments, 3 favorites; current profile 883 followers. | Isla Vista; no gram claim, duration, exact date, shares, or paid distribution verified. |
| [Pacific Catch salmon menu](https://www.tiktok.com/@pacificcatch/video/7690480677514415391) | Salmon bowl and sushi cuts carry a pink omega-3 menu line. | 241 exact tile views, 2 likes, 1 comment, 0 favorites; current profile 410 followers. | Filmed location unknown; the supplement-replacement implication is an overclaim risk, and nutrition, duration, date, shares, and paid reach are unverified. |
| [Just Salad Hero Wrap](https://www.tiktok.com/@justsalad/video/7686197269376306446) | Gloved hands hold a cut Chicken Caesar Wrap; caption calls its wrapper higher fiber and lower carb. | 1,080 exact tile views, 10 likes, 0 comments, 1 favorite, 2 shares; current profile about 13.4K followers. | No comparative baseline or nutrient amounts, exact date, duration, audio content, or paid reach verified. |
| [Carnivorous LA steak bowl](https://www.tiktok.com/@carnivorous.la/video/7698459563955162381) | Steak and fries preparation opens under a bold Eagle Rock hidden-gem line before a restaurant interior cut. | Rounded 15.3K tile views, 673 likes, 17 comments, 230 favorites; current profile 230 followers. | This is a distinct edit from the newer bowl launch, but grams, date, duration, shares, and paid distribution are unknown. |

The [California Fish Grill Instagram upload](https://www.instagram.com/reel/Dd_5x1toa1P/) matched the caption, 56g graphic, and footage of the already counted [TikTok original](https://www.tiktok.com/@dhaorll/video/7692106361575951646).
The [Hive TikTok](https://www.tiktok.com/@sayimafoodie/video/7654092650970107167) repeated the hosted [Instagram Reel](https://www.instagram.com/sayimafoodie.rd/reel/DWAt6oLicy-/), including the gluten-free hook and venue shots.
The [Better Bowls 45g TikTok](https://www.tiktok.com/@betterbowls/video/7688442146772323597) matched the opening powder shot and centered yogurt-build overlay of the already counted [Instagram Reel](https://www.instagram.com/betterbowls.la/reel/DdmjOnsiIz1/).
Each pair retains one creative identity in the CSV, without pooling audience metrics.
The two-spot clean-eating TikTok lacked a dish-specific nutrition comparison and matched the already excluded Instagram concept, so neither upload was counted.

### B15 restaurant swaps and protein choices

| Original TikTok | Inspected food-first hook and angle | Views / current followers | Public response and evidence limit |
| --- | --- | ---: | --- |
| [Hummus Republic shawarma bowl](https://www.tiktok.com/@hummusrepublic/video/7691708553891040520) | A stop-scroll command leads to a Jacksonville protein-focused shawarma bowl in 13 seconds. | About 179,100 / 883 = 202.83 | Views are rounded; nutrition and paid distribution are unverified. |
| [Hummus Republic $10 bowl](https://www.tiktok.com/@hummusrepublic/video/7678105743484013831) | A 23-second build-with-us sequence assembles a customizable Jacksonville protein bowl. | 993 / 883 = 1.12 | The price and protein framing are brand claims; no gram total is verified. |
| [Hummus Republic mushroom wrap](https://www.tiktok.com/@hummusrepublic/video/7200955970984414470) | A 12-second hands-and-torso restaurant wrap sequence presents a meat-free mushroom shawarma swap. | About 16,700 / 883 = 18.91 | The post is dated 2023-02-16, so the current follower denominator is especially distant; location is unknown. |
| [Hummus Republic mushroom pita](https://www.tiktok.com/@hummusrepublic/video/7495875069487385862) | A 12-second Long Branch vegan pita assembly presents another plant-based order. | 2,685 / 883 = 3.04 | Dated 2025-04-21; vegan is a menu attribute, not a proven health outcome. |
| [Carnivorous LA new protein bowls](https://www.tiktok.com/@carnivorous.la/video/7703678650251496717) | A 14-second Eagle Rock lineup shows steak, chicken, and ribs bowls under a new-menu cue. | 175 / 231 = 0.76 | Five likes, zero comments, and one favorite were visible; the post's exact date and paid reach are unknown. |
| [Just Salad tofu order](https://www.tiktok.com/@justsalad/video/7699920795258129694) | A 12-second finished salad and behind-counter build presents tofu as the vegan Tokyo Supergreens order. | 1,226 / about 13,400 = about 0.09 | The account denominator is rounded; LA venue and numeric nutrition are unknown. |
| [Benny's Tacos protein bowl](https://www.tiktok.com/@bennystacos/video/7685432282668174605) | A ten-second West Hollywood bowl close-up leads into behind-counter assembly. | 1,404 / 636 = 2.21 | Twenty likes, zero comments, and three favorites were visible; no gram claim or paid reach was verified. |
| [Hummus Republic Delaware lunch choices](https://www.tiktok.com/@hummusrepublicdelaware/video/7676929095782976782) | An eleven-second food montage contrasts several orders with a labeled $10 protein bowl. | 183 / 62 = 2.95 | Zero likes, comments, and favorites were visibly shown; the tiny denominator and unknown reach limit comparison. |
| [Girl and The Chicken Caesar wrap](https://www.tiktok.com/@girlandthechicken/video/7689518142866967838) | A seven-second wrap close-up uses small white dish text; the caption names chicken and garbanzos for extra protein. | 1,032 / 401 = 2.57 | Burbank brand post; the extra-protein claim has no gram total. |
| [Girl and The Chicken vegan falafel bowl](https://www.tiktok.com/@girlandthechicken/video/7657660013585992974) | A 15-second overhead bowl reveal cuts to gloved assembly of a plant-based order at a chicken restaurant. | 297 / 401 = 0.74 | Burbank brand post; vegan status does not establish a health outcome. |

All ten B15 originals were inspected through signed-in TikTok playback, with matching original profile tile views and same-day current profile follower snapshots.
They add ten measured durations but no verified audible tracks; a displayed music label is not listening evidence.
The two Jacksonville bowl edits differ sharply in view ratio, as do the two Burbank dishes, but age, creative distribution, and account conditions remain uncontrolled.
The Delaware lunch montage [reposted with a campus caption](https://www.tiktok.com/@hummusrepublicdelaware/video/7676158466251115790) used the same visible opening and was excluded as a duplicate creative.
The [Burbank creator lunch review](https://www.tiktok.com/@cyncityeats/video/7602127946836380942), [Summit promotional protein order](https://www.tiktok.com/@summits.life/video/7603909510033362190), and [Hummus Republic fast-food bowl montage](https://www.tiktok.com/@hummusrepublicdelaware/video/7676930670618283277) opened on visible presenter or staff faces, so their captions and protein claims could not qualify them.
The [Burbank broad healthy-food montage](https://www.tiktok.com/@girlandthechicken/video/7684394233905663262) lacked a dish-specific swap or macro angle and was excluded.

### B16 LA menu choices, portion comparison, and food-only edits

| Original video | Inspected hook and restaurant angle | Views / current followers | Evidence and nutrition limit |
| --- | --- | ---: | --- |
| [Girl and The Chicken falafel sandwich](https://www.tiktok.com/@girlandthechicken/video/7657017479327223070) | Fourteen-second plated sandwich reveal cuts to gloved falafel assembly; caption names a vegan restaurant choice. | 745 / 401 = 1.86 | 56 likes, 1 comment, 14 favorites; vegan status is not a verified health outcome. |
| [Girl and The Chicken falafel menu](https://www.tiktok.com/@girlandthechicken/video/7654745257812217102) | Twelve-second three-format lineup shows a bowl, sandwich, and starter in a separate edit from the individual falafel clips. | 940 / 401 = 2.34 | 43 likes, 2 comments, 22 favorites; reused menu items do not prove independent nutrition. |
| [Merka Saltao steak bowl by Gia](https://www.tiktok.com/@itsgiala/video/7541477260738481438) | Bold white outlined 63g surprise text opens on the Culver City steak bowl, then food and location cuts. | Unknown / 7,073 | 179 likes, 9 comments, 101 favorites; posted 2025-08-22; the creator's 63g claim is unverified. |
| [Merka Saltao regular versus large](https://www.tiktok.com/@merka.saltao/video/7699919322352782606) | Twenty-nine-second side-by-side order compares the same steak with different rice and fries portions. | 722 / 1,545 = 0.47 | 27 likes, 3 comments, 5 favorites; no measured calorie difference. |
| [Sweetfin warm bowls by Grace](https://www.tiktok.com/@gracieeela323/video/7611649075548589342) | Twenty-second food-closeup invitation introduces warm protein bowls at the West Third LA location. | Unknown / 5,129 | 40 likes, 4 comments, 2 favorites; numeric protein and sponsorship are unknown. |
| [Sweetfin chef menu by Gotstotryit](https://www.tiktok.com/@gotstotryit/video/7593286253060164878) | Eleven-second storefront-to-menu-and-bowls montage names chicken, tofu, salmon, steak, and vegetable sides. | Unknown / 598 | 441 likes, 4 comments, 47 favorites, 24 shares; no dish-specific grams. |
| [Merka Saltao custom chicken bowl](https://www.instagram.com/merka.saltao/reel/Dez04JsS65G/) | Price labels move across chicken, quinoa, beans, and rice/fries side choices in the Culver City Reel. | 991 / about 10,600 = about 0.09 | 23 likes, 2 visible comments; follower display is rounded, Reel length and saves unknown. |
| [Smokin' Stove coconut-date sweet](https://www.tiktok.com/@smokinstove/video/7691497261787909406) | Eight-second ingredient-to-dessert reveal claims no added sugar for the LA restaurant's Coconut Bliss. | 775 / 254 = 3.05 | 36 likes, 1 comment, 3 favorites; dates contain natural sugar and no total-sugar figure was observed. |
| [Smokin' Stove green wrap](https://www.tiktok.com/@smokinstove/video/7689288447978261773) | Nine-second overhead green-wrap reveal frames the restaurant order as healthy. | 950 / 254 = 3.74 | 19 likes, 1 comment, 3 favorites; green color does not verify lower calories. |
| [Smokin' Stove chopped salad](https://www.tiktok.com/@smokinstove/video/7689279885415648525) | Thirteen-second overhead chopped-salad and dressing edit says salad can be craveable. | 6,092 / 254 = 23.98 | 199 likes, 5 comments, 49 favorites; dressing nutrition and paid reach are unknown. |

All ten B16 links were opened in signed-in Chrome and sampled from their moving original video pages; the Merka Instagram tile supplied the single new Instagram view count.
The three Smokin' Stove edits share one 254-follower snapshot, and the Girl and The Chicken clips share one 401-follower snapshot.
Those clusters and unknown post years prevent treating their view differences as causal creative results.
The [Merka Instagram portion Reel](https://www.instagram.com/merka.saltao/reel/De2GFzZTWBv/) repeats the already counted [TikTok regular-versus-large creative](https://www.tiktok.com/@merka.saltao/video/7699919322352782606) and is not a second example.
The [Sweetfin LA protein clip by Jalen](https://www.tiktok.com/@jaleninlosangeles/video/7550128909841419575), [Sweetfin menu visit by Elle](https://www.tiktok.com/@extracrispyelle/video/7602776408007380254), [Smokin' Stove creator review](https://www.tiktok.com/@scubastaceyy/video/7700847216210038029), and [Sweetfin lean-protein brand clip](https://www.tiktok.com/@sweetfinpoke/video/7070958450435476779) showed presenter faces and were excluded.
The [Ohana Superette chicken bowl](https://www.tiktok.com/@savedyouaplace/video/7618722611245239566) showed a crispy chicken bowl described as fresh, without an observed nutrition swap or macro angle.
The [CAVA stop-motion partnership](https://www.tiktok.com/@hypnomotion/video/7429821185938033952) displayed a paid partnership label and stylized toy-food construction rather than filmed restaurant food, so it informs creative screening but is not in the qualifying dataset.

### B17 restaurant protein choices and Instagram continuation

| Original video | Inspected food hook and nutrition treatment | Views / current followers | Response and evidence limit |
| --- | --- | ---: | --- |
| [California Fish Grill bowls by Cassie](https://www.tiktok.com/@shake_datcass/video/7579899971411971359) | A food-only lineup names five protein bowls; the caption claims a 31-56g protein range and 56g for one bowl. | Unknown / 5,920 | 438 likes, 5 comments, 169 favorites, 237 shares; posted 2025-12-03; grams unverified. |
| [Luna Grill garlic lemon chicken](https://www.tiktok.com/@lunagrillofficial/video/7669932095266966797) | A 38-second food montage names the Santorini Bowl and calls the chicken choice protein-packed without a gram figure. | 680 / 1,117 = 0.61 | 15 likes, 0 comments, 0 favorites, 4 shares; filmed location and nutrition unknown. |
| [Fountain East Hollywood bowls](https://www.instagram.com/fountain.gg/reel/DK-TlRxTtmX/) | Hand-held salad and kimchi-bowl cuts use large white dish labels; the caption discusses local grains and proteins without macros. | 2,137 / 2,642 = 0.81 | 7 comments; posted 2025-06-16; total likes, saves and nutrition unknown. |
| [Protein Shop Caesar wrap](https://www.instagram.com/theproteinshopnyc/reel/DfIZF-hglyO/) | A torso-cropped wrap reveal gives way to a cut-wrap shot; the brand caption claims 77g protein. | 1,731 / about 25,000 = about 0.07 | 32 likes, 3 comments, 1 repost; NYC, duration and protein calculation unknown. |
| [Vine Food Club falafel bowl](https://www.instagram.com/survivingnowthriving/reel/DeXQAiDNWT6/) | Belfast venue, counter, and finished bowl cuts lead to a falafel protein choice without grams. | 2,702 / about 11,000 = about 0.25 | 77 likes, 80 comments, 1 repost; vegan and protein are creator descriptions, with year unknown. |
| [Hosted Hummus Republic lunch](https://www.instagram.com/danikanicoleholt/reel/DexLa0dAgF4/) | A large mixed-font lunch invitation leads to counter and wrap cuts; the caption calls the Wisconsin meal protein-forward. | 2,138 / 6,329 = 0.34, excluded from non-ad pool | 67 likes, 4 comments, 2 reposts; explicitly #hosted, with no numeric macro. |
| [Hummus Republic Honey Harissa bowl](https://www.instagram.com/hummusrepublic/reel/DeeuYWMglIz/) | Bold dish-name text overlays gloved-hand bowl assembly; the brand caption claims 46g protein. | 2,392 / about 25,800 = about 0.09 | 42 likes, 3 comments, 2 reposts; filmed location and gram verification unknown. |
| [Moonbowls BBQ chicken salad](https://www.instagram.com/eatwamburger/reel/DIJ-Xh5SUlM/) | West LA bowl close-ups and a venue cut frame a gluten-free menu with meatless protein options. | Unknown / 1,612 | 74 likes, 18 comments; posted 2025-04-07; creator marks #invite, and no numeric macro is verified. |
| [Xoxo Biscoff protein bowl](https://www.instagram.com/xoxoprotein/reel/Dd4Fiqypl2B/) | A moving hand-held cafe bowl reveal supports brand claims of 29g protein and 300-400 calories. | Unknown / 7,435 | 22 likes, 0 comments, 2 reposts; West Covina cafe, year and numbers unverified. |

The nine retained B17 entries are distinct videos after URL and cross-platform creative checks; the [Kathy Hive Instagram co-post](https://www.instagram.com/lawithkathy/reel/DcUylyahWY2/) repeats an earlier counted TikTok and remains one identity.
The [Hive Buddha Bowl](https://www.instagram.com/hivehealthyeats/reel/De94IaehBix/) remained excluded because its broad vegan-wellness framing lacks a dish-specific swap or macro comparison.
The [Urbane Cafe Harissa Sandwich Reel](https://www.instagram.com/urbanecafe/reel/DfDIi1SgFbH/) repeats a counted TikTok creative, while a separate Glendale paid partner review showed the creator's face later in playback.
An LA protein-bowl keyword search also surfaced meal-prep deliveries, presenter-led restaurant reviews, and broad venue lists that were not counted from snippets or thumbnails.
The B17 TikTok server notice stopped that platform at 03:36 UTC on 2026-11-05; later B17 additions came from Instagram only.
The excluded Sweetgreen original no longer contributes to any performance denominator or B17 comparison.

### B18 Instagram food assembly, retrospectively deduplicated

| Original video | Inspected food hook and nutrition treatment | Views / current followers | Response and evidence limit |
| --- | --- | ---: | --- |
| [Hummus Republic Honey Harissa bowl launch](https://www.instagram.com/hummusrepublic/reel/DdUY-ySB63w/) | A large white and yellow dish-name headline overlays counter-side greens, chicken, toppings, and sauce assembly; the brand caption claims 46g protein. | 3,355 / about 25,800 = about 0.13 | 39 likes; September 15 without year, comments total and shares unknown. This is a separate counter-side build from the later hand-held Honey Harissa Reel. |
| [Just Salad vegan choices](https://www.instagram.com/veganfooder/reel/Dd98LwnCFjs/) | The food-first edit names a Vegan Chipotle Wrap and Tokyo Supergreens Tofu Salad; no protein grams or calorie total appear. | Unknown / about 10,300 | 70 likes, 6 comments, and 2 reposts were visible. Reposts are not shares; the exact year, duration, views, saves, shares, and nutrition verification are unknown. |
| [Girl and The Chicken Burbank bowl](https://www.instagram.com/rachiefindsfood/reel/De751QSvmVm/) | A finished vegetable-and-chicken bowl and falafel wrap support the creator's subjective "super healthy" restaurant recommendation. | 1,157 / 1,320 = 0.88 | 71 likes; October 25 lacked a year, and comments, saves, shares, duration, and nutritional meaning of "healthy" are unknown. |
| [Health Nut tuna lettuce wrap](https://www.instagram.com/healthnutla/reel/DeNU6RmShrH/) | Staff hands assemble tuna, avocado, vegetables, and dressing in lettuce; the bread-free interpretation is inferred from the visible format, not a measured calorie swap. | About 23,700 / about 258,000 = about 0.092 | 277 likes; both view and follower counts are rounded, while comments, saves, shares, duration, and verified nutrition are unknown. |
| [Xoxo Protein berry acai bowl](https://www.instagram.com/xoxoprotein/reel/DfFUu6RpQ7P/) | A close pan across the bowl supports the West Covina cafe's caption claim of 24g protein and 200-300 calories. | 690 / 7,435 = 0.093 | 7 likes; serving basis, comments, saves, shares, duration, and the claim's accuracy are unknown. |
| [Xoxo Protein waffles](https://www.instagram.com/xoxoprotein/reel/DfEBJAOpGcE/) | Two boxed waffle plates receive a slow food-only pan; the caption lists 322 calories and 32g protein, without tying those figures to each topping choice. | 995 / 7,435 = 0.134 | 14 likes; comments, saves, shares, duration, exact serving, and macro verification are unknown. |
| [Xoxo Protein Biscoff bowl](https://www.instagram.com/xoxoprotein/reel/DfBRdKJpHoM/) | A hand-held fruit-topped bowl moves by the cafe window; the caption claims 29g protein and 300-400 calories. | 815 / 7,435 = 0.11 | 12 likes; comments, saves, shares, duration, exact serving, and macro verification are unknown. |

These are selected original Instagram snapshots, not evidence that a particular hook caused the observed views.
The three Xoxo posts share one account denominator, differ in dish and footage, and should not be treated as independent account experiments.
The B18 Protein Shop 100g combination Reel remains excluded because the sampled food-only shots did not establish a distinct whole-video faceless creative from an already excluded TikTok with a presenter.
The Hive Buddha Bowl and the LA two-spot clean-eating Reel were removed from local provisional rows when the staged exclusion-ledger check found prior disqualifying evidence.

The [Better Bowls Instagram protein-goal Reel](https://www.instagram.com/betterbowls.la/reel/DW9iValCE4G/) was first published as a separate B18 row, then removed after a retained-frame audit proved it repeats the counted [Better Bowls TikTok](https://www.tiktok.com/@betterbowls/video/7626915747305901343).
The opening beige bowl, gray marble, fruit and sauce reveal, room-vision overlay, and shadow match in the source-bound offline frame manifest at `/Users/dawitmolla/fitsy-wt/logs/mkt-732-crosspost-20261105T0546/manifest.json`.
The Instagram original showed 911 tile views, 776 current followers and 10 likes, with April 10 displayed without a year; these stay in the TikTok row evidence notes and never replace its TikTok counters or add a second ratio pair.

### Cross-platform creative identity ledger

| Cross-post source | Counted primary source | Decision and retained evidence |
| --- | --- | --- |
| [Better Bowls Instagram protein-goal Reel](https://www.instagram.com/betterbowls.la/reel/DW9iValCE4G/) | [Better Bowls TikTok protein-goal video](https://www.tiktok.com/@betterbowls/video/7626915747305901343) | Same opening and reveal in retained source-bound frames; Instagram counters remain in the TikTok row notes, not in its metric columns. |
| [Hummus Republic Instagram summer bowls](https://www.instagram.com/hummusrepublic/reel/Db8laN8x8Bt/) | [Hummus Republic Delaware TikTok summer bowls](https://www.tiktok.com/@hummusrepublicdelaware/video/7676929540400221453) | Same poolside lineup and 33g Garden Falafel graphic in retained footage; one counted creative. |
| [Hummus Republic Instagram 52g shawarma](https://www.instagram.com/hummusrepublic/reel/De4au0LsBaw/) | [Hummus Republic TikTok 52g shawarma](https://www.tiktok.com/@hummusrepublic/video/7693569934135381256) | Distinctness unresolved on retained frames; conservative exclusion of the Instagram lead. |

### B19 ON+ON restaurant bowls and screened cross-posts

| Original video | Inspected food hook and nutrition treatment | Views / current followers | Response and evidence limit |
| --- | --- | ---: | --- |
| [ON+ON Torrance bowl build by Lala Foodgirl](https://www.instagram.com/lala.foodgirl/reel/DfH9kYfB8cB/) | A three-panel bowl build and gloved protein and vegetable service visualize the creator's healthy customizable meal claim; no numeric macros are shown. | 3,652 / 1,912 = 1.91 | 222 likes; the five-days-ago label was not converted into a calendar date, and nutrition and paid reach are unknown. |
| [ON+ON balanced bowl by the restaurant](https://www.instagram.com/ononkitchen/reel/DLXclBAsIta/) | An overhead multi-bowl spread and broccoli/protein close-up carry "nourish" and "your health" text; the caption names fresh vegetables and proteins. | Unknown / about 16,400 | 303 likes; posted 2025-06-26, while views and precise nutrition are unknown. |
| [ON+ON Torrance review by Stay Wanderfull](https://www.instagram.com/staywanderfull/reel/DeiUOIJO4IK/) | An interior and tabletop edit reveals BBQ beef and kimchi pork bowls beneath the model's face; the caption calls the ingredients a healthy balance. | 3,307 / 5,126 = 0.65 | Likes total and exact posted year are unknown; no presenter face appeared in sampled footage. |
| [ON+ON grilled salmon bowl](https://www.instagram.com/ononkitchen/reel/Dd5Nupkhhkj/) | Gloved hands cut salmon, grill close-ups carry FIRE text, and a finished vegetable and salmon bowl carries FLAVOR text; the restaurant calls it feel-good eating without numeric macros. | 6,784 / about 16,400 = about 0.41 | 190 likes, 2 comments, and 2 reposts observed; September 29 lacked a year, and the separate share count and nutrition are unknown. |

The first two [Hummus Republic Instagram](https://www.instagram.com/hummusrepublic/reel/Db8laN8x8Bt/) [leads](https://www.instagram.com/hummusrepublic/reel/De4au0LsBaw/) inspected for B19 are excluded from the count.
The poolside four-bowl footage and 33g Garden Falafel overlay match the retained [Delaware TikTok summer-bowl footage](https://www.tiktok.com/@hummusrepublicdelaware/video/7676929540400221453).
The 52g shawarma Instagram opening and caption overlap the retained [brand TikTok shawarma creative](https://www.tiktok.com/@hummusrepublic/video/7693569934135381256); its distinctness is unresolved from retained footage, so neither a different source ID nor a different counter justified a second row.
No stopped TikTok page was reopened for these comparisons.

## Footage-inspected examples

### 1. CAVA macro-friendly bowl build

- **Link and source:** [CAVA's TikTok mirrored by Urlebird](https://urlebird.com/video/save-this-for-your-next-post-gym-session-cava-macro-friendly-b-7584209134459964685/), a public fallback, inspected on 2026-11-04.
- **Qualification and direct footage:** The 15-second player showed staff hands adding ingredients to a CAVA bowl, with no visible presenter in the frames inspected.
- **First two seconds:** The opening shows the service line, a scoop into an empty bowl, and centered white all-caps text reading "HOW TO ORDER: MACRO-FRIENDLY CAVA BOWL."
- **On-screen design:** Bold white text with a black outline sits in the middle of vertical food footage; subsequent cuts label ingredients, including tzatziki, grilled chicken, corn, and pita crisps.
- **Calories/macros:** No numeric calorie or gram total was visible in the sampled frames; the caption calls the build macro-friendly and directs viewers to CAVA's nutrition page.
- **Length and pacing:** The public player displayed 0:15; rapid ingredient-by-ingredient assembly cuts continue through the bowl build.
- **Audio:** The mirror labels the track "Levi & Mario - 2 Little 2 Late"; spoken voiceover was not independently confirmed.
- **CTA:** The caption says to save it for a post-gym session and see CAVA's nutrition page.
- **Public engagement snapshot:** The mirror displayed 3.3M views, 17.7K likes, 178 comments, and 2K shares on 2026-11-04.
- **Unknowns:** Exact post date, any unobserved ending text or voiceover, and independent nutrition verification remain unknown.

### 2. CAVA high-protein bowl hack by Thomas McGee

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=oKaggVNLzRw), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled frames at 0, 2, 10, 15, and 20 seconds showed CAVA storefront, bowl assembly, food, and a phone screen, with no presenter visible beyond incidental workers.
- **First two seconds:** A CAVA storefront appears behind large centered white outlined text promising "How to get 55+ grams protein at Cava."
- **On-screen design:** White outlined burned-in subtitles follow rapid cuts from storefront to food preparation and a nutrition app screen.
- **Calories/macros:** The title claims 59g protein; phone-screen numbers were too blurred to read and the claim was not independently verified.
- **Length and pacing:** The player displayed 22 seconds; storefront, assembly, close-up, and app shots change quickly.
- **Audio:** Direct audio and music could not be verified; the subtitles suggest narration but do not prove it.
- **CTA:** A pinned comment points to "Synopsis: Simple Nutrition" in the creator's bio, and the final seconds include a product mention.
- **Public engagement snapshot:** The public YouTube page displayed about 13K views, 182 likes, and 23 comments on 2026-11-04.
- **Unknowns:** Exact full serving, source of the protein claim, spoken audio, and shares are unknown.

### 3. Panda Express order by Levi Ringo

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=qP0N92ExZes), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled frames at 0, 5, 9, and 12 seconds showed storefront, takeout package, food, and a head-cropped torso, with no visible face.
- **First two seconds:** A Panda Express storefront carries a solid red rounded box reading "LOW CALORIE HIGH PROTEIN PANDA EXPRESS ORDER" and smaller text promising macros at the end.
- **On-screen design:** A red headline card gives way to small white outlined order text over handheld food footage.
- **Calories/macros:** The creator's ending overlay claims 785 calories, 74g protein, 22g fat, and 76.5g carbs for a plate with double teriyaki chicken, half white rice, half vegetables, and sauce on the side; it also suggests splitting the serving.
- **Length and pacing:** The player displayed 14 seconds; quick storefront and package shots defer the numeric reveal until near the end.
- **Audio:** Direct audio, music, and voiceover could not be verified.
- **CTA:** No explicit outbound CTA was visible in the sampled frames.
- **Public engagement snapshot:** The public YouTube page displayed about 34K views, 661 likes, and 9 comments on 2026-11-04.
- **Unknowns:** Nutrition accuracy, actual sauce amount, unseen frames, and shares are unknown.

### 4. Subway low-carb protein bowl by SubDooing

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=uyyZULwMvzg), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled frames at 0, 15, and 25 seconds showed gloved hands assembling a Subway bowl at the ingredient counter, with no visible presenter.
- **First two seconds:** The video opens directly on first-person bacon preparation at the counter, without on-screen hook text; the title supplies the low-carb protein-bowl angle.
- **On-screen design:** No text overlay was visible in the sampled frames; a close POV view makes the order components legible through the food itself.
- **Calories/macros:** No numeric calorie or macro claim was visible; the caption lists bacon, lettuce, tomato, red onion, ranch, garlic aioli, and shredded cheese.
- **Length and pacing:** The player displayed 29 seconds; hands assemble the bowl in a continuous, brisk sequence.
- **Audio:** Direct audio, music, and voiceover could not be verified.
- **CTA:** No explicit CTA was visible in the sampled frames.
- **Public engagement snapshot:** The public YouTube page displayed about 57K views, 1,817 likes, and 40 comments on 2026-11-04.
- **Unknowns:** Complete serving and dressing quantities, unseen frames, and shares are unknown.

### 5. Subway chicken bacon ranch keto bowl by SubDooing

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=QpkUhNdF-dw), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled frames at 0, 15, and 25 seconds showed gloved first-person assembly of a separate chicken and bacon bowl at Subway, without a visible face.
- **First two seconds:** An empty bowl at the ingredient counter starts the clip; the keto and higher-protein promise appears in the title and caption rather than on screen.
- **On-screen design:** No text overlay was visible in the sampled frames; the format repeats a simple hands-and-ingredients POV.
- **Calories/macros:** No numeric calories or macros were visible; the caption frames this distinct bowl as a keto and higher-protein order.
- **Length and pacing:** The player displayed 28 seconds; continuous quick assembly follows one bowl from empty to complete.
- **Audio:** Direct audio, music, and voiceover could not be verified.
- **CTA:** No explicit CTA was visible in the sampled frames.
- **Public engagement snapshot:** The public YouTube page displayed about 28K views, 1,067 likes, and 6 comments on 2026-11-04.
- **Unknowns:** Exact ingredients and amounts beyond the named chicken, bacon, and ranch, unseen frames, and shares are unknown.

### 6. Sweetgreen fiber-tracking bowl build

- **Link and source:** [Sweetgreen TikTok mirrored by Urlebird](https://urlebird.com/video/2026-is-the-year-of-fibermaxxing-7655407233945177357/), a public fallback, inspected on 2026-11-04.
- **Qualification and direct footage:** The 27-second video showed gloved hands assembling a restaurant bowl; the ending showed customer legs but no face.
- **First two seconds:** White lower-center sans serif text over the serving line asks, "wait, sweetgreen tracks fiber now?"
- **On-screen design:** A lower-center running fiber counter rises during overhead food assembly, then a white rounded nutrition card appears at the end.
- **Calories/macros:** The counter showed 3g fiber near five seconds and 8g near seventeen seconds; the ending card claimed 40g protein, 60g carbs, 42g fat, 10g fiber, and 760 calories for the featured bowl.
- **Length and pacing:** The public player reported 27.05 seconds; rapid serving-line assembly leads to the final nutrition card.
- **Audio:** The mirror labels "sweetgreen - original sound"; audible voice or music could not be independently confirmed.
- **CTA:** The final overlay says fiber tracking is available in the app; the caption says "2026 is the year of fibermaxxing."
- **Public engagement snapshot:** The mirror displayed 2.04K views, 40 likes, 4 comments, and 11 shares on 2026-11-04.
- **Unknowns:** Exact publication date, nutrition fact source, complete serving, and original-platform engagement are unknown.

### 7. Subway chicken protein bowl by MV Eats

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=oMTwDgs-eg4), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled opening, middle, and ending frames showed a Subway bag and chicken bowl without a visible presenter.
- **First two seconds:** The clip begins with a close-up of a Subway bag; the protein-bowl angle is in the title rather than an on-screen hook.
- **On-screen design:** No text overlay was visible in the sampled frames; the framing moves quickly from branded packaging to a food close-up.
- **Calories/macros:** No numeric calories or macros were visible, and the protein claim is limited to the title's description of the bowl.
- **Length and pacing:** The public player displayed 8 seconds; a brief bag-to-bowl reveal carries the whole clip.
- **Audio:** Direct audio, music, and voiceover could not be verified.
- **CTA:** No explicit CTA was visible in the sampled frames.
- **Public engagement snapshot:** The public YouTube page displayed about 17K views, 127 likes, and 4 comments on 2026-11-04.
- **Unknowns:** Ingredient amounts, nutrition data, unseen frames, and shares are unknown.

### 8. Subway steak and cheese protein bowl by Low carb and keto recipes

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=YlgbiGHWdHY), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled opening, ten-second, and ending frames showed only the restaurant's steak and cheese bowl, without a visible presenter.
- **First two seconds:** The clip starts on a close-up of the finished bowl; its protein-bowl angle is in the title rather than on-screen text.
- **On-screen design:** No text overlay was visible in the sampled frames; the camera makes a slow handheld pass over the food.
- **Calories/macros:** No numeric calories or macro values were visible; the title names a protein bowl, while the channel supplies broader low-carb context.
- **Length and pacing:** The public player displayed 17 seconds; the slow bowl pan is a single visual idea.
- **Audio:** Direct audio, music, and voiceover could not be verified.
- **CTA:** The caption asks viewers to say what they are having in the comments.
- **Public engagement snapshot:** The public YouTube page displayed about 2.5K views, 40 likes, and 0 comments on 2026-11-04.
- **Unknowns:** Serving components, nutrition data, unseen frames, and shares are unknown.

### 9. Supplemental Chipotle protein order by thejacked.gentleman

- **Link and source:** [Public YouTube mirror uploaded by Timothy Mount](https://www.youtube.com/watch?v=OsI8j_1bNaY) with a visible TikTok watermark crediting @thejacked.gentleman; mirror ownership is unconfirmed, inspected on 2026-11-04.
- **Direct footage and count decision:** Sampled frames at 0, 15, 25, and 30 seconds showed a bowl close-up, counter ordering, a fountain drink, and a nutrition-calculator screenshot, without a presenter. The original TikTok post URL was not verified, so this mirror does not count toward the 150-video target.
- **First two seconds:** A bowl fills the frame behind large stacked white and red text reading "Bodybuilder orders HEALTHY CHIPOTLE" and an image claiming 985 calories, 41g fat, 86g protein, and 79g carbs.
- **On-screen design:** Burned-in dialogue captions continue over order footage, followed by a nutrition-calculator screenshot and a closing line praising Chipotle's calculator.
- **Calories/macros:** The opening image presents those numbers as the original creator's claim; its serving and calculation were not independently verified.
- **Length and pacing:** The public player displayed 31 seconds; bowl, counter, drink, and calculator scenes are distinct cuts rather than one continuous assembly.
- **Audio:** Burned-in dialogue captions are visible, but voice and music could not be verified.
- **CTA:** No outbound CTA was visible in the sampled frames; the closing text praises the calculator.
- **Public engagement snapshot:** The mirror page displayed about 27K views and 9 comments on 2026-11-04; likes were not visible.
- **Unknowns:** Mirror authorization, exact serving, nutrition accuracy, audio, unseen frames, likes, and shares are unknown.

### 10. Sweetgreen protein menu montage

- **Link and source:** [Sweetgreen TikTok mirrored by Urlebird](https://urlebird.com/video/my-kind-of-protein-shake-7572235699710119182/), a public fallback, inspected on 2026-11-04.
- **Qualification and direct footage:** The 20.22-second video showed food close-ups and a hand holding items, without a visible face.
- **First two seconds:** A hand pours a Protein Foam item beneath a dark translucent lower-third rectangle reading "34G PROTEIN" in large white type.
- **On-screen design:** Quick hard cuts compare multiple items with the same lower-third numeric treatment: Miso Glazed Salmon, Kale Caesar, Caramelized Garlic Steak, Protein Popcorn, and Canned Chili.
- **Calories/macros:** Overlays claim 34g protein for Miso Glazed Salmon, 41g for Kale Caesar, 41g for Caramelized Garlic Steak, 52g for Protein Popcorn, and 41g for Canned Chili; no calories or complete macros were shown.
- **Length and pacing:** The public player displayed 20.22 seconds; each food item gets a brief close-up before a hard cut to another.
- **Audio:** The mirror labels "sweetgreen - original sound"; audible voice or music could not be confirmed.
- **CTA:** Neither the caption "my kind of protein shake" nor the observed ending included an explicit CTA.
- **Public engagement snapshot:** The mirror displayed 28.64K views, 1.53K likes, 27 comments, and 110 shares on 2026-11-04.
- **Unknowns:** The mirror's approximate post-age label, original TikTok metrics, nutrition source, complete servings, and audio remain unknown.

### 11. Chipotle low-calorie high-protein bowl by Quinn Raulerson

- **Link and source:** [Creator-owned YouTube Short](https://www.youtube.com/watch?v=Kmci67rA65w), inspected on 2026-11-04.
- **Qualification and direct footage:** Sampled frames at 0, 5, 17, 20, and 27 seconds showed a bowl close-up and staff assembling an order from the customer POV, with no presenter visible.
- **First two seconds:** A bowl close-up carries a large yellow outlined all-caps claim, "HIGH PROTEIN LOW CAL CHIPOTLE BOWL / 600CAL / 70G PROTEIN."
- **On-screen design:** White all-caps burned-in order captions with selected words emphasized in red follow the yellow headline over counter footage.
- **Calories/macros:** The opening numbers are the creator's unverified 600-calorie and 70g-protein claim, without a visible complete-serving calculation in the sampled frames.
- **Length and pacing:** The player displayed 29 seconds; quick counter and assembly cuts keep the order moving.
- **Audio:** Captions imply a spoken order, but direct voice and music could not be verified.
- **CTA:** No CTA was visible in the sampled frames or public page description.
- **Public engagement snapshot:** The YouTube page displayed about 6.9K views, 101 likes, and 4 comments on 2026-11-04.
- **Unknowns:** Actual ingredients and portions, accuracy of the numeric claim, unseen frames, audio, and shares are unknown.

### 12. CAVA macro-friendly bowl with full macro stack

- **Link and source:** [CAVA TikTok mirrored by Urlebird](https://urlebird.com/video/save-this-macro-friendly-bowl-for-your-next-gym-session-530-ca-7598677513803533599/), a public fallback distinct from example 1, inspected on 2026-11-04.
- **Qualification and direct footage:** The 19.16-second video showed only gloved hands building a CAVA bowl, with no visible face.
- **First two seconds:** Bold outlined white uppercase text at the top says "HOW TO ORDER: MACRO FRIENDLY CAVA BOWL" while a smaller lower stack lists calories and macros.
- **On-screen design:** Rapid serving-line cuts retain a central outlined white ingredient list that grows as the bowl is assembled; the ending says "SCREENSHOT FOR YOUR NEXT MEAL."
- **Calories/macros:** The opening overlay and caption claim 530 calories, 30g protein, 25g fat, and 48g carbs for the presented bowl, without independent serving verification.
- **Length and pacing:** The player displayed 19.16 seconds; quick ingredient cuts lead to a final full-order screenshot prompt.
- **Audio:** The mirror labels "Pdubcookin - original sound"; audible voice or music could not be confirmed.
- **CTA:** The caption asks viewers to save the bowl for their next gym session and visit CAVA's nutrition page, while the ending asks for a screenshot.
- **Public engagement snapshot:** The mirror displayed 405.92K views, 1.62K likes, 65 comments, and 250 shares on 2026-11-04.
- **Unknowns:** Original post date and engagement, exact serving, nutrition accuracy, and audio remain unknown.

### 13. CAVA save-this-order macro bowl

- **Link and source:** [CAVA TikTok mirrored by Urlebird](https://urlebird.com/video/big-bulky-bowl-for-my-big-bulky-boy-7644739997911797022/), a public fallback distinct from examples 1 and 12, inspected on 2026-11-04.
- **Qualification and direct footage:** The 15.05-second video showed gloved hands and serving-line bowl assembly, without a face.
- **First two seconds:** Bold white black-outlined uppercase text over the food says "SAVE THIS ORDER: MACRO-FRIENDLY CAVA BOWL."
- **On-screen design:** Large bottom-center ingredient labels, including "CUCUMBER," follow the rapid close-up topping cuts; the final copy says "eat up twin you deserve it."
- **Calories/macros:** No numeric calories or macros appear in the observed clip or page caption; "macro-friendly" is a brand framing without a visible serving calculation.
- **Length and pacing:** The public player displayed 15.05 seconds; rapid close-up ingredient cuts follow a single order.
- **Audio:** The mirror labels "Type Beats Trap - Beat Way Up"; spoken voice could not be confirmed.
- **CTA:** The opening asks viewers to save the order; no link or further CTA was visible.
- **Public engagement snapshot:** The mirror displayed 898.88K views, 3.83K likes, 75 comments, and 393 shares on 2026-11-04.
- **Unknowns:** Original post date and engagement, exact serving, nutritional fit, and voiceover remain unknown.

### 14. Chipotle high-protein menu food montage

- **Link and source:** [Chipotle TikTok mirrored by Urlebird](https://urlebird.com/video/cant-go-wrong-try-our-brand-new-high-protein-menu-now-in-the-ch-7586779412733988151/), a public fallback, inspected on 2026-11-04.
- **Qualification and direct footage:** The 10.65-second video showed only close-up restaurant food shots, without a face.
- **First two seconds:** An overhead spread of Chipotle bowls and a burrito sits behind centered lowercase white text with a black edge reading "if ur obsessed with protein try this next."
- **On-screen design:** Rapid glamour cuts move between menu items; later white labels include "high protein-high fiber bowl 46g" and "high protein taco 15g."
- **Calories/macros:** The on-screen 46g and 15g figures appear in high-protein item labels, but the frame does not spell out their unit as protein grams; no calories or full macros are shown.
- **Length and pacing:** The public player displayed 10.65 seconds; each food close-up lasts only a few seconds.
- **Audio:** The mirror labels "Chipotle - original sound"; audible voice or music could not be confirmed.
- **CTA:** The caption directs viewers to try the new high-protein menu in Chipotle's app; no separate on-screen CTA was observed.
- **Public engagement snapshot:** The mirror displayed 14.14M views, 7.62K likes, 232 comments, and 867 shares on 2026-11-04.
- **Unknowns:** Original post date and engagement, exact item servings, what the unlabeled gram figures represent, and audio remain unknown.

## Patterns and pitfalls supported by this sample

The CAVA brand example places the restaurant-order benefit over a live food assembly shot before any brand explanation.
Ingredient labels make the build reproducible and keep the food central, but the footage does not itself establish a complete serving or a verified macro total.
The Panda Express example promises a number at the end, which may support a short reveal, but the visible counters do not test that causal claim.
The CAVA creator example shows how an app insert can demonstrate a nutrition workflow, while a product mention risks making the film feel like an ad.
The two Subway POV clips offer a low-production, repeatable assembly sequence, but their nutrition promises remain unquantified and the formats are highly similar.
Sweetgreen makes a nutrient counter part of the action before showing a full card, but its brand-owned numbers are not evidence for a Fitsy estimate.
The second CAVA bowl clip puts a complete macro stack in the opening and ends with a screenshot prompt, making the order easy to retain while leaving the exact serving unverified.
Chipotle's menu montage fits several products into eleven seconds, but an unexplained "46g" label shows how easy it is to lose the unit and serving behind fast cuts.
A mirrored Chipotle creator clip calls the order "HEALTHY CHIPOTLE" and displays a high-protein total; this is a concrete overclaim risk because the clip does not independently establish the full serving or venue-wide health.
A save prompt offers a concrete reason to retain a post; visible engagement cannot establish that the prompt worked.
For Fitsy, avoid calling a venue healthy, presenting model estimates as official nutrition facts, hiding sauce or side portions, or spending most of a short Reel on an app demo.

## Proposed Fitsy templates, all unexecuted

The dishes below are exact menu candidates from [the merged LA shortlist](la-dish-shortlist.md), not cleared publication claims.
Every numeric caption or overlay is a placeholder until the exact current menu item, entire serving, sauce, side, Fitsy row, confidence tier, and freshness are checked in the actual app.
The shortlist's DEV estimates were recorded in April 2026, so even its existing numbers are not a current production claim.
Use "fitsy estimates ~[verified X]g protein" only after that check; otherwise use a food-only draft with no number.

### Template A: Silver Lake bowl reveal

- **Dish:** BBQ+RICE Spicy Chicken in Silver Lake.
- **Opening hook:** "A Silver Lake chicken bowl to know" over the first close-up.
- **Shot list:** Venue sign or menu location cue; close-up of the named bowl; two details of chicken, rice, and gochujang marinade; complete bowl; short Fitsy estimate card when the Gate is satisfied.
- **Overlay layout:** Top: "Silver Lake dinner idea"; center: "Spicy Chicken at BBQ+RICE"; lower third: "fitsy estimates ~[verified X]g protein" and a small "estimate for this bowl" label; final frame: "Find the dish in fitsy."
- **Caption pattern:** "Silver Lake dinner idea: Spicy Chicken at BBQ+RICE, with rice and gochujang marinade.
  For this bowl, fitsy estimates ~[verified X]g protein.
  See the dish and estimate in fitsy - link in bio."
- **Gate:** The shortlist has an older MEDIUM-confidence DEV candidate of ~32g protein; verify the complete current bowl before filling the slot.

### Template B: Weeknight chicken plate

- **Dish:** Pine & Crane Three Cup Chicken in Silver Lake, listed in Fitsy DEV as Three Cup Jidori Chicken.
- **Opening hook:** "Silver Lake chicken order for dinner" over the plated dish.
- **Shot list:** Pine & Crane location cue; plated Three Cup Chicken; close detail of sauce and sides; full plate; short Fitsy estimate card when the Gate is satisfied.
- **Overlay layout:** Top: "Silver Lake dinner order"; center: "Three Cup Chicken at Pine & Crane"; lower third: "fitsy estimates ~[verified X]g protein" with a small "estimate for this plate" label; final frame: "Explore the dish in fitsy."
- **Caption pattern:** "Three Cup Chicken at Pine & Crane in Silver Lake: a specific chicken plate for your next dinner list.
  For this plate, fitsy estimates ~[verified X]g protein.
  Explore the dish in fitsy - link in bio."
- **Gate:** The shortlist has an older HIGH-confidence DEV candidate of ~38g protein, but explicitly flags the name and serving match.

### Template C: One defined seafood serving

- **Dish:** Playita Mariscos Campechana: Mixto, 16 oz cup in Silver Lake.
- **Opening hook:** "A Silver Lake seafood cup with a real serving size" over the complete order.
- **Shot list:** Venue cue; named 16 oz cup; visible avocado, seafood, and crackers; whole serving laid out; short Fitsy estimate card when the Gate is satisfied; final dish shot.
- **Overlay layout:** Top: "Silver Lake seafood order"; center: "Campechana: Mixto, 16 oz cup"; lower third: "fitsy estimates ~[verified X]g protein" and "estimate for this cup"; final frame: "See the dish in fitsy."
- **Caption pattern:** "Playita Mariscos in Silver Lake: Campechana: Mixto, 16 oz cup, with seafood, avocado, and crackers.
  For this cup, fitsy estimates ~[verified X]g protein.
  Find the dish in fitsy - link in bio."
- **Gate:** The shortlist has an older MEDIUM-confidence DEV candidate of ~28g protein; verify avocado and crackers are included.

### Template D: No-number discovery until coverage exists

- **Dish:** Kismet Rotisserie Chicken + Rice Bowl in East Hollywood.
- **Opening hook:** "East Hollywood chicken and rice worth a closer look" over the full bowl.
- **Shot list:** Venue sign; current menu label; full bowl; rice and yogurt sauce details; final neighborhood cue and dish close-up.
- **Overlay layout:** Top: "East Hollywood dinner idea"; center: "Chicken + Rice Bowl at Kismet Rotisserie"; lower third: "chicken, rice, yogurt sauce"; final frame: "Save this East Hollywood order."
- **Caption pattern:** "An East Hollywood dinner idea: Chicken + Rice Bowl at Kismet Rotisserie, with rice and yogurt sauce.
  Save the specific order for your next neighborhood meal."
- **Gate:** The shortlist recorded this venue as missing in bounded DEV search, which does not prove production absence; "fitsy estimates ~[verified X]g protein" remains an internal placeholder and is omitted from the food-only viewer draft.
