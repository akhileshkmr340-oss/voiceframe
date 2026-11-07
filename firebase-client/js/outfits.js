// VoiceFrame's own outfit catalogue: what a character wears, for the character editor's
// outfit picker, the AI outfit suggestions, the Director's set_outfit and every picture prompt.
// Descriptions are generic and original (no brands, shops, designers or celebrities).
//
// Safety (a family site): every outfit has a minimum age (and kids' clothes a maximum).
// Revealing party looks, open-shirt looks and shorts-style looks are adults only (18+).
// Children and teenagers are only ever offered, suggested or painted in age-appropriate
// everyday, school, festive and traditional clothes: outfitPrompt() enforces it again for
// every prompt, whatever was chosen. thumb: left empty for now (thumbnails can be added later
// without painting them on the shared free allowance).
//
// Row: id | name | gender (f, m, u) | minAge[-maxAge] | occasions | era | region | moods | description
// Occasions: d college/daily, c café/shopping, o office, p party/night, n date night,
// f festival, w wedding, t travel, v village/farm, s sport.
export const OCCASIONS = { d: 'College / daily', c: 'Café / shopping', o: 'Office', p: 'Party / night', n: 'Date night', f: 'Festival', w: 'Wedding', t: 'Travel', v: 'Village / farm', s: 'Sport' };
export const CATEGORIES = [
  ['trad', 'Indian traditional', '🪔'], ['fusion', 'Indo-Western fusion', '✨'], ['casual', 'Casual & streetwear', '👟'], ['glam', 'Party & evening', '🌃'],
  ['formal', 'Formal & office', '💼'], ['festive', 'Festive & wedding', '🎊'], ['village', 'Village & farming', '🌾'], ['historical', 'Historical', '🏰'],
  ['myth', 'Mythological', '🔱'], ['sport', 'Sports & gym', '🏏'], ['uniform', 'Uniforms', '🎖'], ['world', 'World traditional', '🌍'],
  ['winter', 'Winter', '🧣'], ['kids', 'Children', '🧸']
];
const ROWS = {
  trad: `
saree-cotton|Handloom cotton saree|f|14|d,f,v|modern|India|simple,graceful|Soft handloom cotton saree with a contrast woven border, matching short-sleeve blouse, flat leather sandals, small gold studs, hair in a low bun
saree-silk-south|Temple-border silk saree|f|14|f,w|timeless|South India|rich,festive|Heavy silk saree with a wide temple-pattern zari border, elbow-sleeve silk blouse, gold necklace and bangles, jasmine flowers in a braided bun
saree-brocade|Brocade silk saree|f|16|w,f,p|timeless|North India|regal,rich|Brocade silk saree with woven gold floral motifs, matching blouse, kundan earrings, a small bindi, sleek middle-parted bun
saree-nauvari|Nine-yard Maharashtrian saree|f|16|f,w|traditional|Maharashtra|bold,traditional|Nine-yard saree draped dhoti-style in bright silk, nose ring, green glass bangles, crescent bindi, hair in a bun with a gajra
saree-bengal|White saree with red border|f|16|f,w|traditional|Bengal|classic,festive|Crisp white cotton saree with a broad red border, red blouse, red and white bangles, a large red bindi, hair in a loose bun
saree-kasavu|Kerala off-white gold-border saree|f|14|f,w|traditional|Kerala|serene,elegant|Off-white cotton saree with a gold kasavu border, gold blouse, temple jewellery, jasmine in long open hair
salwar-kameez|Salwar kameez with dupatta|f|10|d,f,t|modern|North India|comfortable,everyday|Knee-length printed cotton kameez, loose matching salwar, a light chiffon dupatta, flat juttis, small hoops, a long plait
anarkali|Anarkali suit|f|12|f,w,p|modern|North India|graceful,festive|Flared floor-length anarkali kurta in georgette with embroidered yoke, churidar, net dupatta, chandbali earrings, soft curls
churidar-kurta|Churidar kurta|f|12|d,o,f|modern|India|neat,classic|Straight calf-length kurta in printed cotton, fitted churidar, a contrasting dupatta, block-heel sandals, a watch, a neat ponytail
patiala-suit|Patiala suit with phulkari dupatta|f|12|f,d|modern|Punjab|cheerful,bright|Short kurta over pleated Patiala salwar, a vivid embroidered phulkari dupatta, embroidered juttis, paranda tassels in a long plait
kurti-leggings|Everyday kurti & leggings|f|12|d,c,t|modern|India|easy,everyday|Hip-length block-print cotton kurti, ankle-length leggings, slip-on flats, small oxidised studs, a casual ponytail
half-saree|Half-saree (langa voni)|f|12|f,w|traditional|South India|youthful,festive|Long silk pavadai skirt, matching blouse with elbow sleeves, a contrast half-saree drape over the shoulder, jhumkas, a long braid with flowers
mekhela-chador|Mekhela chador|f|14|f,w|traditional|Assam|graceful,earthy|Two-piece cream silk mekhela and chador with woven red motifs, matching blouse, gold earrings, hair in a neat bun
ghagra-odhni|Rajasthani ghagra choli & odhni|f|12|f,v|traditional|Rajasthan|colourful,folk|Wide mirror-work ghagra skirt, long-sleeve choli, a tie-dye odhni over the head, silver anklets and bangles, a long plait
kurta-pyjama|Kurta pyjama|m|10|d,f|modern|India|simple,classic|Knee-length white cotton kurta, loose pyjama trousers, leather kolhapuri sandals, a wristwatch, neatly combed hair
dhoti-kurta|Dhoti-kurta|m|12|f,w,v|traditional|India|traditional,dignified|Pleated white cotton dhoti, cream kurta, a folded angavastram on one shoulder, leather sandals, a sandalwood tilak
lungi-shirt|Lungi & half-sleeve shirt|m|16|d,v|modern|South India|relaxed,everyday|Checked cotton lungi folded at the waist, half-sleeve cotton shirt, rubber slippers, a towel over the shoulder, short hair
mundu-shirt|Kerala mundu & shirt|m|14|f,d,w|traditional|Kerala|crisp,serene|Off-white mundu with a thin gold border, crisp white half-sleeve shirt, leather sandals, a thin gold chain
pathani-suit|Pathani suit|m|12|f,d|modern|North-west India|sturdy,smart|Long collared pathani kurta with two chest pockets, salwar trousers, peshawari chappals, a trimmed beard
nehru-jacket-kurta|Kurta with Nehru jacket|m|14|f,o,w|modern|India|smart,festive|Silk-blend kurta, churidar, a fitted mandarin-collar Nehru jacket in a contrast colour, mojaris, a pocket square
bandhgala|Bandhgala suit|m|18|w,o,p|modern|Rajasthan|regal,formal|Closed-neck bandhgala jacket with brass buttons, slim matching trousers, polished leather shoes, a brooch, slicked-back hair
angrakha-kurta|Angrakha kurta|u|14|f,w|traditional|North India|elegant,heritage|Side-tied angrakha wrap kurta in block-printed cotton, straight trousers, embroidered juttis, minimal jewellery
dhoti-pheta|Marathi dhoti & pheta|m|16|f,w|traditional|Maharashtra|proud,festive|White dhoti and kurta, a bright saffron pheta turban, a sleeveless jacket, kolhapuri chappals, a moustache
kurta-dastar|Kurta pyjama with turban|m|12|d,f,w|modern|Punjab|dignified,warm|Long kurta and pyjama, a neatly tied dastar turban in a solid colour, a steel kara bracelet, juttis, a full beard
jodhpuri-suit|Jodhpuri suit|m|18|w,p|modern|Rajasthan|royal,sharp|Embroidered bandhgala coat, jodhpur breeches, a printed safa turban, leather mojaris, a pearl string`,
  fusion: `
fz-chikan-jeans|Chikankari short kurti & jeans|f|13|d,c,t|modern|India|fresh,easy|White chikankari-embroidered short cotton kurti, light-wash straight jeans, tan kolhapuri flats, small silver jhumkas, loose wavy hair
fz-crop-maxi|Crop top & printed maxi skirt|f|18|c,f,n|modern|India|boho,breezy|Fitted solid crop top, flowing ankle-length printed maxi skirt, oxidised silver necklace, strappy flat sandals, soft beach waves
fz-corset-lehenga|Corset blouse & lehenga skirt|f|18|p,w,f|modern|India|bold,festive|Structured embroidered corset blouse, flared silk lehenga skirt, a sheer dupatta on one arm, statement earrings, a sleek high bun
fz-predrape|Pre-draped saree|f|18|p,w|modern|India|chic,modern|Ready-pleated saree in a solid satin shade with a belt at the waist, a sleek modern blouse, block heels, ear cuffs, a low side bun
fz-shirt-brocade|White shirt & brocade skirt|f|16|f,c,o|modern|India|crisp,heritage|Crisp white cotton shirt tucked into a long woven brocade skirt, a thin belt, juttis, gold hoops, a neat ponytail
fz-dhoti-pants|Kurti with dhoti pants|f|13|d,f|modern|India|playful,comfy|Short asymmetric kurti over draped dhoti pants, a long jacket optional, embroidered juttis, a stack of thin bangles, a side braid
fz-waistcoat-jeans|Ethnic waistcoat over tee & jeans|u|13|d,c|modern|India|cool,easy|Block-print ethnic waistcoat over a plain tee, dark jeans, white sneakers, a beaded bracelet, messy textured hair
fz-saree-sneakers|Casual saree with sneakers|f|16|d,c,f|modern|India|quirky,relaxed|Soft cotton saree with a tee-style blouse, clean white sneakers, a canvas tote, round glasses, a messy bun
fz-peplum-dhoti|Peplum top & dhoti skirt|f|16|f,p|modern|India|stylish,festive|Embroidered peplum top over a draped dhoti skirt, a metallic belt, block heels, chandbalis, softly curled hair
fz-kurta-dress|Belted long kurta dress|f|13|d,c,o|modern|India|smart,easy|Calf-length printed kurta dress with a fabric belt, mules, a slim watch, small studs, hair in a half-up twist
fz-kurti-palazzo|Short kurti & palazzo pants|f|13|d,o,t|modern|India|breezy,everyday|Short straight kurti, wide flowing palazzo pants, a printed stole, flat sandals, hoop earrings, a low ponytail
fz-cape-palazzo|Cape top & palazzo set|f|16|p,f,w|modern|India|elegant,modern|Sheer embroidered cape over a matching top and palazzo pants, heeled sandals, statement studs, sleek straight hair
fz-denim-lehenga|Denim jacket over lehenga skirt|f|16|f,c|modern|India|edgy,festive|Cropped denim jacket over a full-length mirror-work lehenga skirt and plain top, juttis, oxidised earrings, a fishtail braid
fz-shrug-sharara|Long shrug & sharara set|f|16|f,w|modern|India|graceful,airy|Floor-length embroidered shrug over a fitted top and flared sharara pants, heeled juttis, maang tikka, soft waves
fz-indo-gown|Indo-western draped gown|f|18|w,p|modern|India|dramatic,elegant|Floor-length gown with a draped dupatta-style pallu across the shoulder, a zari belt, heels, a statement ring, a sleek bun
fz-angrakha-jeans|Angrakha wrap top & jeans|f|13|d,c|modern|India|heritage,casual|Side-tied angrakha wrap top in block-print cotton, cropped jeans, kolhapuri flats, a thin silver anklet, a loose braid
fz-jumpsuit-dupatta|Block-print jumpsuit with dupatta|f|16|c,f|modern|India|easy,artsy|Wide-leg block-print cotton jumpsuit with a contrast dupatta, flat mules, wooden bangles, a top knot
fz-kurta-blazer|Kurta with blazer|f|18|o|modern|India|sharp,professional|Straight silk-cotton kurta, slim cigarette trousers, a tailored blazer, pointed flats, a slim watch, a low ponytail
fz-mirror-skirt-tee|Mirror-work skirt & tee|f|13|f,c|modern|India|fun,folk|Plain tucked tee, a long mirror-work skirt, oxidised neckpiece, kolhapuris, a messy braid
fz-floral-midi-jutti|Floral midi dress & juttis|f|13|c,d|modern|India|sweet,fresh|Floral cotton midi dress with sleeves, embroidered juttis, a small sling bag, hair in a soft half-up
fz-kurta-jeans-m|Short kurta & jeans|m|13|d,c|modern|India|easy,smart|Hip-length cotton kurta with rolled sleeves, slim jeans, loafers, a leather watch, short textured hair
fz-bandi-shirt-m|Shirt with ethnic bandi jacket|m|13|f,o|modern|India|smart,festive|Solid shirt with a printed sleeveless bandi jacket, chinos, loafers, a pocket square, neatly combed hair
fz-achkan-trousers-m|Achkan-style jacket & slim trousers|m|18|w,p|modern|India|sharp,regal|Long achkan-style jacket with a mandarin collar, slim trousers, polished brogues, a brooch, a groomed beard
fz-dhoti-jacket-m|Dhoti pants & long jacket|m|16|w,f|modern|India|bold,festive|Draped dhoti pants, a kurta, a long open embroidered jacket, mojaris, a kada bracelet
fz-kurta-joggers-m|Kurta, joggers & sneakers|m|13|d,t|modern|India|comfy,street|Short cotton kurta over slim joggers, chunky sneakers, a cross-body bag, a cap`,
  casual: `
cs-tee-jeans|T-shirt & jeans|u|5|d,c,t|modern|Global|easy,everyday|Plain cotton crew-neck tee, straight blue jeans, white canvas sneakers, a simple watch, casual hair
cs-hoodie-joggers|Hoodie & joggers|u|5|d,t|modern|Global|cosy,relaxed|Soft fleece hoodie, matching joggers, running shoes, a backpack, slightly messy hair
cs-oversized-cargo|Oversized tee & cargo pants|u|13|d,c|modern|Global|street,cool|Oversized graphic-free tee, loose cargo pants, chunky sneakers, a bucket hat, a chain bracelet
cs-denim-jacket|Denim jacket, tee & chinos|u|13|d,c,t|modern|Global|classic,cool|Light denim jacket over a white tee, khaki chinos, suede sneakers, aviator sunglasses
cs-polo-chinos|Polo shirt & chinos|m|13|d,c,o|modern|Global|neat,smart|Pique polo shirt, slim chinos, leather loafers, a steel watch, side-parted hair
cs-check-shirt|Checked shirt & jeans|m|13|d,c|modern|Global|easy,rugged|Buttoned checked cotton shirt with rolled sleeves, dark jeans, desert boots, a leather strap watch
cs-linen-shorts-m|Linen shirt & shorts|m|18|c,t|modern|Global|summery,relaxed|Light linen shirt, tailored above-knee shorts, espadrilles, sunglasses, tousled hair
cs-midi-sundress|Floral midi sundress|f|13|c,n,t|modern|Global|sunny,sweet|Floral cotton midi dress with short sleeves, flat sandals, a straw hat, a woven bag, loose hair
cs-pleated-midi|Blouse & pleated midi skirt|f|13|d,c,o|modern|Global|soft,neat|Tucked-in soft blouse, pleated midi skirt, ballet flats, pearl studs, a low bun
cs-leather-jacket|Leather jacket, tee & black jeans|u|16|c,n,p|modern|Global|edgy,cool|Black leather biker jacket, plain tee, black skinny jeans, ankle boots, silver rings
cs-streetwear|Streetwear: hoodie, cargos & chunky sneakers|u|13|d,c|modern|Global|bold,street|Bold-colour hoodie, wide cargo trousers, chunky sneakers, a cross-body bag, a beanie
cs-cardigan-jeans|Cardigan & straight jeans|u|13|d,c|modern|Global|cosy,soft|Knit cardigan over a plain top, straight jeans, loafers, round glasses, hair tucked behind the ears
cs-dungarees|Denim dungarees & striped tee|u|5|d,c|modern|Global|playful,cute|Denim dungarees over a striped long-sleeve tee, canvas sneakers, hair in two buns or short and tousled
cs-sweatshirt-skirt|Sweatshirt & denim midi skirt|f|13|d,c|modern|Global|casual,cute|Crew-neck sweatshirt, a long denim skirt, white sneakers, a tote, a claw-clip updo
cs-henley-jeans|Henley & jeans|m|13|d,c|modern|Global|rugged,easy|Long-sleeve henley shirt, slim jeans, leather boots, a beard, a leather bracelet
cs-kurti-jeans-college|College kurti & jeans|f|13|d|modern|India|everyday,easy|Short printed kurti, blue jeans, a dupatta-style scarf, sneakers, a backpack, a ponytail
os-white-open|White open-collar shirt & jeans|f|18|d,c,n|modern|Global|crisp,effortless|Crisp white full-sleeve shirt worn with an open collar and rolled cuffs, high-waist blue jeans, white sneakers, gold hoops, loose waves
os-satin-jeans|Satin shirt & high-waist jeans|f|18|n,p,c|modern|Global|glossy,chic|Champagne satin full-sleeve shirt with an open collar, high-waist straight jeans, pointed mules, a thin gold chain, sleek straight hair
os-open-over-tank|Oversized open shirt over a tank top|f|18|c,t|modern|Global|relaxed,cool|Oversized linen shirt worn open over a plain tank top, wide jeans, flat sandals, sunglasses on the head, a messy bun
os-front-tie|Front-tie shirt & high-waist trousers|f|18|c,n|modern|Global|playful,smart|Full-sleeve shirt knotted at the front waist, high-waist wide trousers, block heels, small hoops, a high ponytail
os-stripe-denim-shorts|Striped shirt & denim shorts|f|18|c,t|modern|Global|summery,breezy|Blue-and-white striped full shirt with rolled sleeves, denim shorts, white sneakers, a canvas tote, beachy hair
os-linen-wide|Linen open shirt & wide trousers|f|18|t,c|modern|Global|airy,minimal|Loose linen shirt open at the collar, matching wide linen trousers, leather slides, a straw tote, a low bun
os-denim-over-tee|Denim shirt open over a white tee|u|18|d,c|modern|Global|casual,classic|Washed denim shirt worn open over a white tee, black jeans, sneakers, a watch, tousled hair
os-flannel-over-tee|Open flannel shirt over a tee|u|18|d,t|modern|Global|grunge,cosy|Red check flannel shirt worn open over a band-free plain tee, ripped jeans, boots, a beanie
os-shirt-dress|Belted shirt dress|f|18|o,c,n|modern|Global|smart,feminine|Knee-length full-sleeve shirt dress with a waist belt, loafers or mules, a structured handbag, a sleek ponytail
os-half-tucked|Half-tucked shirt & relaxed jeans|f|18|d,c|modern|Global|effortless,cool|Oversized full-sleeve shirt half-tucked into relaxed straight jeans, sneakers, gold studs, hair tucked behind one ear
os-camp-collar-m|Open-collar camp shirt & chinos|m|18|c,n,t|modern|Global|laid-back,summer|Short-sleeve camp-collar printed shirt with the top button open, beige chinos, loafers, sunglasses
os-overshirt-m|Overshirt open over a henley|m|18|d,c|modern|Global|rugged,layered|Heavy cotton overshirt worn open over a henley, dark jeans, boots, a leather watch`,
  glam: `
gl-bodycon-mini|Bodycon mini dress|f|18|p,n|modern|Global|bold,glam|Fitted knee-skimming bodycon dress in a deep jewel tone, strappy heels, a mini clutch, statement earrings, glossy blow-dried hair
gl-offshoulder-mini|Off-shoulder mini dress|f|18|p,n|modern|Global|flirty,glam|Off-shoulder short dress with long sleeves, block heels, a chain-strap bag, drop earrings, soft curls
gl-satin-slip|Satin slip dress|f|18|n,p|modern|Global|sleek,minimal|Midi satin slip dress with thin straps, a cropped tailored jacket over the shoulders, heeled sandals, a fine necklace, a sleek low bun
gl-sequin-dress|Sequin dress|f|18|p|modern|Global|sparkly,party|Knee-length sequin dress with long sleeves in silver or gold, metallic heels, ear cuffs, voluminous waves
gl-slit-gown|High-slit evening gown|f|18|p,w|modern|Global|dramatic,elegant|Floor-length satin evening gown with a side slit to the knee, pointed heels, diamond-style drops, an elegant updo
gl-cutout-cocktail|Cut-out cocktail dress|f|18|p,n|modern|Global|modern,bold|Knee-length cocktail dress with small cut-outs at the waist, minimal sandals, a box clutch, a sleek ponytail
gl-halter-dress|Halter-neck dress|f|18|p,n|modern|Global|chic,summer-night|Midi halter-neck dress in a solid bright colour, strappy heels, gold cuff, hair in a high bun
gl-one-shoulder|One-shoulder gown|f|18|p,w|modern|Global|graceful,glam|Floor-length one-shoulder gown with a soft drape, heels, a cocktail ring, side-swept curls
gl-blazer-dress|Blazer dress|f|18|p,o,n|modern|Global|power,sharp|Double-breasted mid-thigh blazer dress, sheer tights, pointed pumps, a gold chain, a sleek bob
gl-corset-leather|Corset top & leather trousers|f|18|p|modern|Global|edgy,glam|Structured satin corset top with a jacket on the shoulders, faux-leather trousers, stiletto boots, hoops, a high ponytail
gl-metallic-coord|Metallic co-ord set|f|18|p|modern|Global|futuristic,party|Metallic shirt and wide trousers set, platform heels, chunky silver jewellery, wet-look hair
gl-feather-mini|Feather-trim mini dress|f|18|p|modern|Global|playful,glam|Short shift dress with feather trim at the hem and cuffs, heeled sandals, a mini bag, glossy waves
gl-velvet-wrap|Velvet wrap dress|f|18|n,p|modern|Global|rich,romantic|Knee-length velvet wrap dress in wine red, heeled boots, pearl drops, a soft side part
gl-openback-gown|Open-back evening gown|f|18|p,w|modern|Global|elegant,dramatic|Long-sleeve floor-length gown with an open back panel, heels, a slim bracelet, a low chignon
gl-satin-jumpsuit|Wide-leg satin jumpsuit|f|18|p,n|modern|Global|sleek,modern|Satin wide-leg jumpsuit with a wrap neckline, heels, a statement belt, sleek straight hair
gl-sequin-saree|Sequin saree & designer blouse|f|18|p,w|modern|India|glam,festive|Lightweight sequin saree in midnight blue, a sleek sleeveless designer blouse, heels, statement studs, glossy open hair
gl-tux-velvet-m|Velvet tuxedo jacket|m|18|p,w|modern|Global|suave,glam|Velvet tuxedo jacket with satin lapels, black shirt, slim trousers, patent shoes, slicked-back hair
gl-satin-shirt-m|Black satin shirt & tailored trousers|m|18|p,n|modern|Global|sleek,night|Black satin shirt, tailored trousers, Chelsea boots, a silver chain, a sharp fade haircut
gl-sequin-blazer-m|Sequin blazer & black shirt|m|18|p|modern|Global|bold,party|Sequin blazer over a black shirt and trousers, polished shoes, a statement ring, styled quiff
gl-allblack-m|All-black leather night look|m|18|p,n|modern|Global|edgy,cool|Black leather jacket, black tee, black jeans, boots, rings and a chain`,
  formal: `
fo-suit-tie-m|Two-piece suit & tie|m|18|o,w|modern|Global|sharp,formal|Navy two-piece suit, white shirt, silk tie, black oxford shoes, a steel watch, a neat side part
fo-trouser-suit-f|Trouser suit|f|18|o|modern|Global|confident,sharp|Tailored blazer and trousers, a silk shell top, pointed pumps, pearl studs, a sleek low bun
fo-office-saree|Office saree|f|18|o|modern|India|graceful,professional|Cotton-silk saree in a muted shade with a neat blouse, a slim watch, a small bindi, a low bun, a laptop bag
fo-kurta-trousers|Straight kurta & trousers|f|18|o|modern|India|neat,professional|Straight-cut kurta, matching cigarette trousers, a light stole, block heels, small studs, a neat braid
fo-shirt-trousers-m|Formal shirt & trousers|m|16|o|modern|Global|neat,office|Pressed full-sleeve shirt, formal trousers, a leather belt, polished shoes, an ID lanyard
fo-pencil-skirt|Blouse & knee-length pencil skirt|f|18|o|modern|Global|classic,office|Silk blouse, knee-length pencil skirt, low pumps, a structured tote, pearl studs, a French twist
fo-blazer-jeans|Blazer, shirt & dark jeans|u|18|o,c|modern|Global|smart-casual,easy|Unstructured blazer over a crisp shirt, dark jeans, loafers, a leather watch
fo-sheath-blazer|Sheath dress & blazer|f|18|o|modern|Global|polished,power|Knee-length sheath dress with a fitted blazer, pumps, a slim bracelet, a bob
fo-three-piece-m|Three-piece suit|m|18|w,o|modern|Global|dapper,classic|Grey three-piece suit with a waistcoat, a pocket watch chain, a patterned tie, brogues
fo-lawyer|Lawyer's black coat & white bands|u|22|o|modern|India|serious,formal|Black court coat over a white shirt with white neck bands, black trousers or saree, black shoes, neat hair
fo-anchor|News anchor: jacket & blouse|f|18|o|modern|Global|crisp,camera-ready|Bright tailored jacket over a plain blouse, small studs, a lapel mic, a smooth blow-dry
fo-turtleneck-blazer|Turtleneck & blazer|u|18|o|modern|Global|minimal,modern|Black turtleneck under a camel blazer, slim trousers, minimalist sneakers or loafers, rimless glasses`,
  festive: `
fw-bridal-lehenga|Bridal lehenga|f|18|w|timeless|North India|bridal,opulent|Heavily embroidered red bridal lehenga, matching choli with sleeves, a veil dupatta over the head, kundan necklace set, maang tikka, nath, mehendi hands
fw-bridal-silk-saree|South Indian bridal silk saree|f|18|w|timeless|South India|bridal,regal|Rich silk bridal saree with a heavy gold border, temple jewellery, an oddiyanam waist belt, jasmine in a long braid
fw-groom-sherwani|Groom sherwani with safa|m|18|w|timeless|North India|regal,groom|Ivory and gold sherwani, churidar, a printed safa turban with a brooch, a pearl mala, mojaris
fw-sherwani|Sherwani|m|14|w,f|timeless|North India|festive,regal|Knee-length embroidered sherwani, churidar, a stole, mojaris, a groomed beard
fw-lehenga-choli|Festive lehenga choli|f|12|f,w|modern|India|festive,bright|Full-length embroidered lehenga with an elbow-sleeve choli and a long dupatta draped over the shoulder, jhumkas, bangles, a braided updo
fw-sharara|Sharara suit|f|12|w,f|modern|North India|graceful,festive|Short embroidered kurta, flared sharara pants, a gota-trim dupatta, juttis, earrings, soft curls
fw-gharara|Gharara|f|14|w|heritage|Lucknow|heritage,elegant|Kurta with a flared gharara gathered at the knee, a long dupatta, pearl jewellery, a centre-parted bun
fw-anarkali-gown|Floor-length anarkali gown|f|12|w,f|modern|India|flowing,festive|Floor-length anarkali gown with an embroidered bodice, net dupatta, heels, chandbalis, open waves
fw-silk-kurta-m|Silk kurta & churidar|m|12|f,w|modern|India|festive,classic|Raw-silk kurta in a jewel tone, churidar, mojaris, a gold button set, combed hair
fw-mehendi|Mehendi outfit|f|16|w,f|modern|India|cheerful,green|Green and yellow printed lehenga or suit, floral jewellery, mehendi-painted hands, flowers in a loose braid
fw-haldi|Haldi yellow outfit|u|12|w|modern|India|sunny,joyful|Bright yellow cotton kurta set, a floral garland, marigold accents, kolhapuris
fw-diwali-kurta-jacket|Diwali kurta & jacket|m|12|f|modern|India|warm,festive|Silk kurta in gold or maroon, a brocade Nehru jacket, churidar, juttis, a diya in hand
fw-onam-set|Onam set-mundu|f|12|f|traditional|Kerala|serene,festive|Off-white set-mundu with a gold border, a green or red blouse, gold jewellery, jasmine in the hair
fw-eid|Eid outfit|u|8|f|modern|South Asia|festive,elegant|Embroidered kurta or long kameez in pastel, matching salwar, a light dupatta or skullcap, attar, sandals
fw-garba-chaniya|Navratri chaniya choli|f|12|f|traditional|Gujarat|vibrant,dance|Twirling mirror-work chaniya skirt, colourful choli with sleeves, a bandhani dupatta, oxidised jewellery, a long plait
fw-garba-kediyu|Navratri kediyu & dhoti|m|12|f|traditional|Gujarat|vibrant,dance|Frilled kediyu top with mirror work, a dhoti, a bandhani turban, mojaris
fw-white-wedding-gown|White wedding gown with veil|f|18|w|modern|Global|bridal,classic|Long-sleeve white lace wedding gown, a long veil, a bouquet, pearl earrings, an elegant updo
fw-tuxedo|Tuxedo|m|18|w,p|modern|Global|classic,formal|Black tuxedo, white shirt, bow tie, cufflinks, patent shoes, slicked hair`,
  village: `
vl-farmer-m|Farmer: dhoti, vest & gamchha|m|16|v|timeless|Rural India|earthy,hardworking|Knee-length cotton dhoti, a sleeveless vest, a red checked gamchha on the shoulder, rubber chappals, a sun-weathered face
vl-farmer-f|Farm woman: tucked cotton saree|f|16|v|timeless|Rural India|earthy,strong|Faded cotton saree tucked up for field work, a long-sleeve blouse, the pallu over the head, glass bangles, a sickle and basket
vl-shepherd|Shepherd: blanket & turban|m|16|v|timeless|Rajasthan|rugged,nomadic|White kurta and dhoti, a coarse wool blanket over one shoulder, a large bright turban, a wooden staff, leather juttis
vl-fisher-m|Fisherman: lungi & vest|m|16|v|timeless|Coastal India|weathered,coastal|Folded checked lungi, a vest, a towel on the head, bare feet on sand, a fishing net
vl-fisher-f|Fisherwoman: saree & basket|f|16|v|timeless|Coastal India|lively,coastal|Bright cotton saree tied tightly, a fish basket on the head, gold nose stud, flowers in the hair
vl-potter|Village potter|m|16|v|timeless|Rural India|craft,earthy|Clay-smudged kurta with rolled sleeves, a dhoti, bare feet, a cloth headband
vl-weaver|Village weaver|f|16|v|timeless|Rural India|craft,quiet|Simple handloom saree, a shawl, silver toe rings, hair in a plain bun, threads in hand
vl-pahadi|Hill villager: wool jacket & cap|u|10|v|timeless|Himalayas|hardy,warm|Woollen jacket over a kurta, a patterned hill cap, wool socks and boots, rosy cheeks
vl-tea-garden|Tea-garden worker|f|16|v|timeless|Assam|hardworking,green|Cotton saree, a long-sleeve blouse, a cloth hat or headscarf, a large basket strapped on the back
vl-elder-m|Village elder|m|50|v,f|timeless|Rural India|wise,dignified|Plain white dhoti-kurta, a wool shawl, a walking stick, round spectacles, a white moustache
vl-grandma|Village grandmother|f|50|v,f|timeless|Rural India|gentle,wise|Plain cotton saree with the pallu over grey hair, a warm shawl, glass bangles, a rudraksha or bead string
vl-cart-driver|Bullock-cart driver|m|16|v|timeless|Rural India|rugged,simple|Dhoti and rough cotton shirt, a cloth turban, a stick for the bullocks, cracked leather chappals`,
  historical: `
hi-mughal-emperor|Mughal emperor|m|18|w,f|Mughal era|North India|imperial,opulent|Brocade jama robe, a jewelled patka sash, a turban with a plume and gem, pearl strings, curled-toe juttis, a trimmed beard
hi-mughal-lady|Mughal court lady|f|18|w,f|Mughal era|North India|regal,graceful|Long peshwaz gown over churidar, a fine gauze dupatta over the head, layered pearl jewellery, kohl-lined eyes, a long plait
hi-mughal-courtier|Mughal courtier|m|18|w|Mughal era|North India|courtly,refined|Ankle-length angarkha, a sash, a neat pagri turban, a curved sword at the waist, juttis
hi-rajput-king|Rajput king|m|18|w|medieval|Rajasthan|valiant,regal|Chainmail over a brocade angarkha, a jewelled safa, a sword and shield, a curled moustache, leather boots
hi-rajput-queen|Rajput queen|f|18|w|medieval|Rajasthan|regal,proud|Rajputi poshak with a long kurti and full ghagra, an odhni over the head, borla forehead ornament, heavy gold jewellery
hi-maratha-warrior|Maratha warrior|m|16|f|17th century|Maharashtra|brave,martial|Angarkha tunic, tight trousers, a pagadi turban, a sword and shield, a waist sash, a moustache
hi-1857-sepoy|1857 sepoy|m|16|f|1857|North India|martial,historic|Red woollen tunic, white trousers, a cross belt, a tall shako cap or turban, an old musket
hi-1857-rani|1857 warrior queen|f|18|f|1857|North India|fearless,heroic|Fitted angarkha with a waist sash, jodhpur trousers, a turban, a sword, riding boots, hair tied back
hi-colonial-officer|Colonial-era officer|m|18|o|colonial era|India|stiff,period|Khaki tunic with brass buttons, khaki trousers, a pith helmet, leather boots, a moustache
hi-colonial-lady|Colonial-era lady|f|18|o,p|colonial era|India|period,refined|Long high-neck gown with puffed sleeves, gloves, a wide-brimmed hat, a parasol, hair in a bun
hi-freedom-m|Freedom movement volunteer|m|16|f|1930s-40s|India|idealistic,simple|Handspun khadi kurta and dhoti, a white khadi cap, a cloth shoulder bag, round glasses
hi-freedom-f|Freedom movement woman|f|16|f|1930s-40s|India|resolute,simple|White khadi saree with a thin border, a long-sleeve blouse, a cloth bag, hair in a simple bun
hi-ancient-king|Ancient Indian king|m|18|w|ancient|India|majestic,ancient|Silk dhoti, an uttariya shawl across the chest, armlets, a jewelled crown, earrings, long hair
hi-ancient-woman|Ancient Indian noblewoman|f|16|w,f|ancient|India|graceful,ancient|Draped silk antariya skirt, a fitted long-sleeve blouse, an uttariya shawl covering the shoulders, gold armlets, a flowered bun
hi-monk-robes|Buddhist monk robes|u|8|f,t|timeless|Asia|serene,spiritual|Saffron or maroon draped robes, a shaven head, prayer beads, sandals, an alms bowl
hi-vedic-sage|Vedic sage|m|30|f|ancient|India|wise,ascetic|Saffron dhoti and shawl, rudraksha beads, matted hair in a top knot, a long beard, a wooden water pot
hi-roman-toga|Roman toga|m|18|f|ancient|Rome|classical,stately|White wool toga with a purple border over a tunic, leather sandals, a laurel wreath
hi-medieval-knight|Medieval knight|m|18|f|medieval|Europe|valiant,armoured|Chainmail, a cloth surcoat with a crest, a cloak, a sword belt, leather boots
hi-victorian-dress|Victorian dress|f|18|p,w|Victorian|Europe|period,elegant|High-neck Victorian gown with a fitted bodice and full skirt, lace gloves, a cameo brooch, hair in an updo
hi-1920s-beaded|1920s beaded dress|f|18|p|1920s|Global|jazz-age,glam|Drop-waist beaded dress below the knee, a long pearl string, T-strap heels, a finger-waved bob with a headband
hi-1950s-tea|1950s tea dress|f|16|c,n|1950s|Global|retro,sweet|Full-skirted polka-dot tea dress, a cardigan, kitten heels, a headscarf, pin curls
hi-1970s-flares|1970s flares & printed shirt|u|16|p,c|1970s|India|retro,groovy|Wide-collar printed shirt, high-waist bell-bottom trousers, platform shoes, big sunglasses, a voluminous hairdo`,
  myth: `
my-flute-player|Divine flute-player|m|0|f|mythological|India|divine,playful|Yellow silk dhoti, a peacock-feather crown, a vaijayanti flower garland, gold armlets, a bamboo flute
my-goddess|Goddess attire|f|13|f|mythological|India|divine,radiant|Red silk saree with gold border, a golden crown, layered temple necklaces, a lotus in hand, long open hair
my-warrior-deity|Warrior deity|m|16|f|mythological|India|divine,mighty|Silk dhoti, golden armour plates, a crown, a bow and quiver, a sacred thread
my-sage|Sage in saffron|m|30|f|mythological|India|serene,ascetic|Saffron robes, rudraksha strings, a water pot, matted hair, a calm forehead mark
my-demon-king|Demon king (stage style)|m|18|f|mythological|India|menacing,grand|Dark brocade robes, a horned golden crown, heavy necklaces, a mace, kohl-rimmed eyes
my-celestial-dancer|Celestial dancer|f|18|f|mythological|India|ethereal,graceful|Silk lehenga with a long-sleeve fitted blouse, a sheer veil, gold anklets with bells, flowers in braided hair
my-epic-queen|Epic-era queen|f|18|w,f|mythological|India|regal,serene|Royally draped silk saree, a gold crown, a waist belt, long earrings, a long braid with flowers
my-epic-prince|Epic-era prince|m|13|f|mythological|India|noble,heroic|Silk dhoti, an angavastram, a small crown, a bow, armlets, long hair
my-forest-exile|Forest exile|u|13|f|mythological|India|humble,serene|Simple bark-coloured cotton robes, wooden beads, bare feet, hair tied in a knot
my-greek-myth|Greek-myth chiton|u|18|f|mythological|Greece|classical,divine|White draped chiton with a gold cord belt, a laurel crown, leather sandals, a himation cloak`,
  sport: `
sp-cricket-whites|Cricket whites|u|8|s|modern|Global|sporty,classic|White cricket shirt and trousers, a cap, spiked shoes, batting pads and gloves
sp-football-track|Football training kit (full-length)|u|8|s|modern|Global|sporty,team|Team jersey, full-length training pants, football boots, shin guards
sp-gym-f|Gym: training tee & leggings|f|16|s|modern|Global|fit,active|Fitted training tee, full-length leggings, running shoes, a fitness band, a high ponytail
sp-gym-m|Gym: training tee & track pants|m|16|s|modern|Global|fit,active|Dry-fit tee, tapered track pants, cross-trainers, a towel on the shoulder
sp-yoga|Yoga: loose tee & yoga pants|u|13|s|modern|Global|calm,flexible|Loose cotton tee, full-length yoga pants, bare feet, a mat, hair in a bun
sp-running-shorts|Running: tee & running shorts|u|18|s|modern|Global|energetic,sporty|Light running tee, running shorts, cushioned running shoes, a cap, a sports watch
sp-badminton|Badminton: polo & track pants|u|13|s|modern|Global|quick,sporty|Sports polo, track pants, court shoes, a sweatband, a racquet
sp-cycling|Cycling jersey & tights|u|16|s,t|modern|Global|fast,sporty|Cycling jersey, full-length cycling tights, a helmet, gloves, sunglasses
sp-hiking|Hiking gear|u|13|t,s|modern|Global|outdoorsy,ready|Light rain jacket, cargo trousers, hiking boots, a backpack, a sun hat
sp-tracksuit|Tracksuit|u|5|s,d|modern|Global|sporty,comfy|Zip-up tracksuit jacket and pants, sneakers, a water bottle
sp-kabaddi|Kabaddi team kit|m|18|s|modern|India|tough,team|Sleeveless team jersey, sports shorts, knee guards, bare feet, a headband`,
  uniform: `
un-school-boy|School uniform (shirt, trousers, tie)|m|5-18|d|modern|India|neat,school|White half-sleeve shirt, grey or navy trousers, a striped tie, black school shoes, a backpack, neatly combed hair
un-school-girl|School uniform (shirt, skirt & leggings)|f|5-18|d|modern|India|neat,school|White shirt, a knee-length pleated skirt over leggings, a striped tie, black shoes, two plaits with ribbons, a backpack
un-school-salwar|School uniform (salwar kameez)|f|11-18|d|modern|India|neat,school|White salwar kameez with a coloured dupatta crossed at the waist, black shoes, a single plait, a school bag
un-police|Police uniform|u|21|o|modern|India|authority,serious|Khaki police shirt with shoulder badges, khaki trousers, a belt, a cap, black boots, a lanyard whistle
un-army|Army combat uniform|u|18|o|modern|India|disciplined,brave|Camouflage combat uniform, a patrol cap, combat boots, a name tape
un-navy|Navy whites|u|18|o|modern|Global|crisp,proud|White naval uniform with shoulder boards, a peaked cap, polished black shoes
un-airforce|Air force blues|u|18|o|modern|Global|proud,disciplined|Blue-grey service uniform, wings badge, a peaked cap, black shoes
un-doctor|Doctor: white coat & stethoscope|u|23|o|modern|Global|caring,professional|White coat over formal clothes, a stethoscope around the neck, an ID badge, comfortable shoes
un-nurse|Nurse: scrubs|u|20|o|modern|Global|caring,calm|Blue scrubs, a fob watch, comfortable clogs, hair tied back neatly
un-chef|Chef whites|u|18|o|modern|Global|busy,skilled|Double-breasted chef jacket, checked trousers, an apron, a chef's toque
un-pilot|Airline pilot|u|21|t,o|modern|Global|calm,assured|Navy pilot jacket with sleeve stripes, white shirt, a tie, a cap with badge, aviator sunglasses
un-firefighter|Firefighter gear|u|18|o|modern|Global|brave,heroic|Heavy reflective fire jacket and trousers, a helmet, boots, gloves
un-scout|Scout uniform|u|8-18|d,t|modern|Global|cheerful,helpful|Scout shirt with badges, a neckerchief with a woggle, trousers, a cap, a backpack`,
  world: `
wd-kimono|Kimono|f|12|f,w|traditional|Japan|graceful,serene|Silk kimono with a floral pattern, a wide obi sash, tabi socks with zori sandals, hair in a neat updo with a pin
wd-yukata|Yukata|u|8|f|traditional|Japan|summer,light|Light cotton yukata with a simple obi, wooden geta sandals, a paper fan
wd-hanbok-f|Hanbok (women)|f|8|f,w|traditional|Korea|bright,graceful|Short jeogori jacket with a ribbon tie, a full high-waist chima skirt, embroidered shoes, a braided bun with a pin
wd-hanbok-m|Hanbok (men)|m|8|f,w|traditional|Korea|dignified,calm|Jeogori jacket, baji trousers, a long vest, a black gat hat or none, cloth shoes
wd-hanfu|Hanfu|u|12|f,w|traditional|China|flowing,classical|Layered flowing robes with wide sleeves and a cross collar, a sash, cloth shoes, hair in a topknot with a hairpin
wd-qipao|Qipao|f|16|f,p,w|1930s-modern|China|elegant,classic|Silk qipao with a mandarin collar and knot buttons, below-knee length, heels, pearl earrings, finger waves
wd-changshan|Changshan|m|16|f,w|1930s-modern|China|scholarly,classic|Long silk changshan gown with knot buttons, trousers, cloth shoes, round glasses
wd-ao-dai|Ao dai|f|14|f,w,d|traditional|Vietnam|graceful,flowing|Long fitted ao dai tunic over wide silk trousers, a conical hat, flat sandals, long straight hair
wd-chut-thai|Thai traditional dress|f|14|f,w|traditional|Thailand|ornate,graceful|Silk sinh skirt, a draped sabai with a fitted top underneath, gold belt and jewellery, a neat bun
wd-deel|Mongolian deel|u|8|t,f|traditional|Mongolia|hardy,steppe|Thick silk-lined deel robe with a bright sash, a fur-trimmed hat, leather riding boots
wd-thobe|Thobe & ghutra|m|8|d,f|modern|Gulf|crisp,traditional|Ankle-length white thobe, a red-checked or white ghutra headscarf with an agal cord, leather sandals
wd-abaya|Abaya with headscarf|f|12|d,f|modern|Middle East|modest,elegant|Flowing black abaya with fine embroidery at the cuffs, a matching headscarf, flat shoes, a handbag
wd-kaftan|Kaftan|u|16|t,f|traditional|North Africa|airy,relaxed|Long embroidered kaftan in light cotton, leather babouche slippers, a woven bag
wd-djellaba|Djellaba|u|10|d,t|traditional|Morocco|earthy,traditional|Hooded long djellaba robe in striped wool, babouche slippers, a leather pouch
wd-ottoman|Ottoman-era kaftan & fez|m|18|f|Ottoman era|Turkey|stately,period|Long brocade kaftan, a sash, a red fez, pointed leather slippers, a moustache
wd-kente|Kente cloth|u|14|f,w|traditional|Ghana|proud,vibrant|Kente cloth draped over one shoulder in bold woven stripes, beaded necklace, leather sandals
wd-dashiki|Dashiki|u|8|d,f|modern|West Africa|vibrant,easy|Loose dashiki tunic with a bold printed neckline, matching trousers, sandals, a kufi cap
wd-boubou|Grand boubou|m|16|f,w|traditional|West Africa|majestic,flowing|Wide flowing embroidered boubou robe over trousers, a matching cap, leather slippers
wd-agbada|Agbada|m|18|w,f|traditional|Nigeria|regal,festive|Three-piece agbada with an embroidered wide outer robe, a fila cap, beads, leather shoes
wd-iro-buba-gele|Iro, buba & gele|f|16|w,f|traditional|Nigeria|bold,festive|Wrapper skirt, loose blouse, a tall sculpted gele head-tie, coral beads, heels
wd-kitenge|Kitenge wrap dress|f|12|d,f|modern|East Africa|bright,cheerful|Bold-print kitenge wrap dress with sleeves, a matching headwrap, sandals, wooden bangles
wd-shuka|Maasai shuka|u|12|t,f|traditional|Kenya|proud,bright|Red checked shuka cloth wrapped over a tunic, layered bead collars, leather sandals, a walking stick
wd-kilt|Highland kilt|m|16|w,f|traditional|Scotland|proud,heritage|Tartan kilt, a white shirt, a tweed jacket, a sporran, knee socks, brogues
wd-dirndl|Dirndl|f|16|f|traditional|Bavaria|cheerful,folk|Dirndl dress with a fitted bodice and a white blouse with sleeves, a full skirt to below the knee, an apron, braided hair
wd-lederhosen|Lederhosen & checked shirt|m|16|f|traditional|Bavaria|festive,folk|Knee-length leather breeches with braces, a checked shirt, wool knee socks, a felt hat
wd-flamenco|Flamenco dress|f|16|f,p|traditional|Spain|passionate,vivid|Long ruffled polka-dot flamenco dress with sleeves, a fringed shawl, a flower in a sleek bun, large hoops
wd-sarafan|Sarafan|f|12|f|traditional|Russia|folk,warm|Long sarafan pinafore dress over a white blouse, an embroidered headband, a long braid
wd-charro|Charro suit|m|16|f,w|traditional|Mexico|proud,festive|Short embroidered jacket, fitted trousers with silver buttons, a wide sombrero, a bow tie, boots
wd-huipil|Huipil & skirt|f|10|f,d|traditional|Mexico|colourful,crafted|Embroidered huipil blouse, a long woven skirt, ribbons in braids, sandals
wd-andean-poncho|Andean poncho & hat|u|8|t,v|traditional|Andes|warm,bright|Striped woven poncho, a felt hat, wool trousers or skirt, sandals, a woven bag`,
  winter: `
wi-puffer|Puffer jacket, beanie & boots|u|5|d,t|modern|Global|cosy,winter|Padded puffer jacket, a knit beanie, jeans, snow boots, a scarf, gloves
wi-overcoat|Wool overcoat & scarf|u|16|o,c|modern|Global|smart,winter|Long camel wool overcoat, a knit scarf, a turtleneck, trousers, leather boots
wi-pheran|Kashmiri pheran & shawl|u|5|d,f|traditional|Kashmir|warm,heritage|Long woollen pheran with embroidery at the neck, a pashmina-style shawl, warm socks and boots
wi-cable-sweater|Cable-knit sweater & jeans|u|5|d,c|modern|Global|cosy,soft|Chunky cable-knit sweater, jeans, ankle boots, a wool cap
wi-trench|Trench coat & boots|u|18|o,c,t|modern|Global|classic,moody|Belted beige trench coat, a scarf, dark trousers, leather boots, an umbrella
wi-ski|Ski jacket & goggles|u|8|s,t|modern|Global|sporty,snowy|Insulated ski jacket and pants, goggles on a helmet, ski gloves, boots
wi-indian-winter|Sweater, muffler & woollen cap|u|0|d,v|modern|North India|homely,winter|Hand-knit sweater, a woollen muffler, a monkey-style woollen cap, a shawl, warm socks with sandals`,
  kids: `
kd-tee-shorts|Kids' tee & knee-length shorts|u|2-12|d,c|modern|Global|playful,everyday|Bright cotton tee, knee-length cotton shorts, sneakers with velcro straps, a small backpack
kd-frock|Cotton frock & sandals|f|2-12|d,c|modern|Global|sweet,everyday|Knee-length cotton frock with short sleeves, sandals, hair in two pigtails with clips
kd-kurta-pyjama|Kids' kurta pyjama|m|2-12|f|traditional|India|festive,cute|Small silk-blend kurta with pyjama, a little Nehru jacket, juttis
kd-pavadai|Girls' silk pavadai|f|2-12|f,w|traditional|South India|festive,cute|Long silk pavadai skirt with a matching sleeved blouse, small jhumkas, a braid with flowers
kd-lehenga|Girls' festive lehenga|f|2-12|f,w|modern|India|festive,bright|Full-length embroidered lehenga with a sleeved choli and a light dupatta, bangles, a ponytail with a bow
kd-dhoti-kurta|Boys' dhoti-kurta|m|2-12|f|traditional|India|festive,traditional|Small white dhoti with a cream kurta, a tiny angavastram, sandals
kd-hoodie|Kids' hoodie & joggers|u|2-12|d|modern|Global|cosy,playful|Colourful hoodie, joggers, light-up sneakers, a cap
kd-dungarees|Kids' dungarees|u|2-12|d|modern|Global|playful,cute|Denim dungarees over a striped tee, canvas shoes
kd-raincoat|Raincoat & gumboots|u|2-12|d,t|modern|Global|rainy,cute|Yellow hooded raincoat, gumboots, a little umbrella
kd-sweater|Kids' sweater & woollen cap|u|2-12|d|modern|Global|cosy,winter|Knitted sweater, a woollen cap with a pompom, mittens, trousers
kd-party-dress|Girls' party dress|f|2-12|p,f|modern|Global|sweet,party|Knee-length party dress with sleeves and a tulle skirt, ballet flats, a headband
kd-party-boy|Boys' party outfit|m|2-12|p,f|modern|Global|smart,party|Shirt, a small waistcoat, trousers, a clip-on bow tie, loafers
kd-village-boy|Village boy|m|2-12|v|timeless|Rural India|simple,playful|Cotton vest and knee-length shorts, bare feet or slippers, a slingshot, tousled hair
kd-village-girl|Village girl|f|2-12|v|timeless|Rural India|simple,bright|Long cotton skirt and a sleeved blouse, two braids with ribbons, glass bangles, slippers
kd-sports|Kids' sports outfit|u|4-12|s|modern|Global|active,playful|Sports tee, track pants, sneakers, a water bottle
kd-night-suit|Cotton night suit|u|2-12|d|modern|Global|sleepy,soft|Long-sleeve printed cotton night suit, soft slippers, a teddy bear
kd-salwar|Girls' salwar suit|f|4-12|d,f|modern|India|neat,everyday|Cotton salwar kameez with a small dupatta, sandals, a neat plait
kd-krishna|Janmashtami costume|m|2-12|f|mythological|India|cute,festive|Yellow dhoti, a peacock-feather crown, a little flute, a bead necklace`
};

export const OUTFITS = [];
for (const [cat, text] of Object.entries(ROWS)) {
  for (const row of text.trim().split('\n')) {
    const [id, name, g, ages, occ, era, region, moods, desc] = row.split('|').map(s => s.trim());
    const [minAge, maxAge] = ages.split('-').map(Number);
    OUTFITS.push({ id, name, cat, gender: g, minAge: minAge || 0, maxAge: maxAge || 120, occasions: occ.split(','), era, region, moods: moods.split(','), desc, thumb: '' });
  }
}
const BY_ID = new Map(OUTFITS.map(o => [o.id, o]));
export const outfitById = id => BY_ID.get(id) || null;

// ---------------- ages ----------------
export const AGE_PRESETS = [['child', 'Child', 8], ['teen', 'Teen', 15], ['young', 'Young adult', 22], ['adult', 'Adult', 32], ['middle', 'Middle-aged', 48], ['elderly', 'Elderly', 70]];
// The age class the rest of the app uses (voices, picture checks).
export const ageClass = years => (years < 13 ? 'child' : years < 18 ? 'teen' : years < 60 ? 'adult' : 'elder');
const CLASS_YEARS = { child: 9, teen: 15, adult: 30, elder: 68 };
// A character's age in years: their own number, or from the writer's class or words.
export function ageOf(c) {
  const n = Math.round(+c?.ageYears);
  if (n >= 1 && n <= 110) return n;
  const m = /\b(\d{1,2})[- ]?(?:years?|yrs?)[- ]?old\b|,\s*(\d{1,2})\s*,/.exec(String(c?.appearance || ''));
  if (m) return +(m[1] || m[2]);
  return CLASS_YEARS[c?.age] || 30;
}
export const isMinor = c => ageOf(c) < 18;
export const genderWord = (g, years) => g === 'female' ? (years < 13 ? 'girl' : years < 18 ? 'teenage girl' : 'woman') : g === 'male' ? (years < 13 ? 'boy' : years < 18 ? 'teenage boy' : 'man') : (years < 13 ? 'child' : years < 18 ? 'teenager' : 'person');
// "32-year-old woman"
export const personWords = c => { const y = ageOf(c); return `${y}-year-old ${genderWord(c?.gender, y)}`; };

// ---------------- who may wear what ----------------
// A catalogue outfit is offered (and painted) only for an age it allows and, unless the
// character's gender is other/unspecified, their gender or a unisex one.
export function allowed(o, c) {
  const y = ageOf(c);
  if (!o || y < o.minAge || y > o.maxAge) return false;
  if (o.gender === 'u' || !c || !['female', 'male'].includes(c.gender)) return true;
  return o.gender === c.gender[0];
}
export const outfitsFor = c => OUTFITS.filter(o => allowed(o, c));
// Free words a child's or teenager's outfit may never have (and, for anyone, nothing a family
// site would not paint). Returns a reason, or ''.
const ADULT_ONLY_WORDS = /\b(bikini|swim ?suit|swimwear|bathing suit|lingerie|underwear|bra|panties|thong|corset|crop ?top|mini ?(?:skirt|dress)|bodycon|off[- ]shoulder|strapless|backless|open[- ]back|cut[- ]?outs?|slit|low[- ]cut|plunging|sheer|see[- ]through|mesh|halter|slip dress|shorts|hot pants|tank top|midriff|bare|tight|revealing|sexy|seductive|clubwear)\b/i;
const NEVER_WORDS = /\b(nude|naked|topless|nipples?|lingerie|underwear|panties|thong|see[- ]through|sexy|seductive|fetish|nsfw)\b/i;
export function outfitIssue(text, c) {
  const t = String(text || '');
  if (NEVER_WORDS.test(t)) return 'VoiceFrame paints family-friendly outfits only.';
  if (isMinor(c) && ADULT_ONLY_WORDS.test(t)) return `${ageOf(c)} is under 18: children and teenagers wear ordinary, age-appropriate clothes only.`;
  return '';
}
const SAFE_DEFAULT = { child: 'kd-tee-shorts', teen: 'cs-tee-jeans' };

// ---------------- a character's outfit choice ----------------
// choice: { id (catalogue id or 'custom'), colour, fabric, text, slots: { top: {text, colour,
// fabric}, bottom, layer, footwear, jewellery, hair } }
// A wardrobe: c.wardrobe = [{ wid, label, ...choice }]; c.outfit = the default choice; a shot
// picks one with sc.outfits = { <character id>: wid }.
export const SLOTS = [['top', 'Top'], ['bottom', 'Bottom'], ['layer', 'Layer'], ['footwear', 'Footwear'], ['jewellery', 'Jewellery'], ['hair', 'Hair']];
export const COLOURS = ['', 'white', 'ivory', 'cream', 'beige', 'black', 'charcoal', 'grey', 'navy', 'blue', 'sky blue', 'teal', 'green', 'emerald', 'olive', 'mint', 'yellow', 'mustard', 'gold', 'saffron', 'orange', 'rust', 'red', 'maroon', 'wine', 'pink', 'blush', 'magenta', 'lavender', 'purple', 'brown', 'tan', 'silver', 'multicolour', 'pastel'];
export const FABRICS = ['', 'cotton', 'linen', 'silk', 'satin', 'chiffon', 'georgette', 'velvet', 'brocade', 'khadi', 'denim', 'wool', 'knit', 'leather', 'faux leather', 'lace', 'chikankari', 'block print', 'bandhani', 'sequin'];
// One outfit as words for a picture prompt, for this character (age and gender enforced:
// an outfit their age doesn't allow is replaced by an ordinary one, free words a minor may
// not wear are left out).
export function outfitPrompt(choice, c) {
  if (!choice) return '';
  const y = ageOf(c), minor = y < 18;
  let o = choice.id && choice.id !== 'custom' ? outfitById(choice.id) : null;
  if (o && !allowed(o, { ...c, gender: ['female', 'male'].includes(c?.gender) ? c.gender : 'other' })) {
    console.warn(`Outfit “${o.name}” is not for a ${y}-year-old: an ordinary outfit is used`);
    o = minor ? outfitById(SAFE_DEFAULT[y < 13 ? 'child' : 'teen']) : null;
  }
  const keep = t => { const s = String(t || '').trim().slice(0, 200); return s && !outfitIssue(s, c) ? s : ''; };
  const parts = [];
  const head = [choice.colour, choice.fabric].filter(Boolean).join(' ');
  if (o) parts.push(`${head ? head + ' ' : ''}${o.name.toLowerCase()}: ${o.desc}`);
  else if (head) parts.push(`${head} clothes`);
  const slots = SLOTS.map(([k, label]) => { const s = choice.slots?.[k]; const t = keep([s?.colour, s?.fabric, s?.text].filter(Boolean).join(' ')); return t && `${label.toLowerCase()}: ${t}`; }).filter(Boolean);
  if (slots.length) parts.push(slots.join(', '));
  const free = keep(choice.text);
  if (free) parts.push(free);
  if (!parts.length) return '';
  return `Outfit: ${parts.join('; ')}${minor ? '; ordinary, age-appropriate clothes, fully clothed' : ''}`;
}
// The outfit a character wears in a shot (the shot's wardrobe pick, else their default).
export function outfitForShot(c, sc) {
  const wid = sc?.outfits?.[c.id];
  return (wid && c.wardrobe?.find(w => w.wid === wid)) || c.outfit || null;
}
export const outfitLabel = choice => {
  if (!choice) return 'No outfit chosen';
  const o = outfitById(choice.id);
  return [choice.colour, choice.fabric, o ? o.name : choice.text ? choice.text.slice(0, 40) : 'Custom outfit'].filter(Boolean).join(' ');
};
// The catalogue outfit closest to free words ("maroon cotton saree"), for this character.
export function outfitFromText(text, c) {
  const t = String(text || '').toLowerCase().replace(/\bsari\b/g, 'saree').replace(/\bshalwar\b/g, 'salwar').replace(/\bpajama\b/g, 'pyjama').replace(/\bkurti\b/g, 'kurti kurta');
  if (!t.trim()) return null;
  let best = null, score = 0;
  for (const o of outfitsFor(c)) {
    const words = `${o.name} ${o.id.replace(/-/g, ' ')}`.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !['with', 'and', 'outfit', 'wear', 'dress'].includes(w));
    const s = words.filter(w => t.includes(w)).length / Math.max(2, words.length);
    if (s > score) { score = s; best = o; }
  }
  return score >= 0.34 ? best : null;
}
// Fills what every character needs (age in years, gender, an outfit), from the writer's
// words when it gave none. Kept as it is when set.
export function ensureFields(c) {
  if (!['female', 'male', 'other'].includes(c.gender)) c.gender = /^f/i.test(c.gender || '') ? 'female' : /^m/i.test(c.gender || '') ? 'male' : 'other';
  c.ageYears = ageOf(c);
  c.age = ageClass(c.ageYears);
  if (!c.outfit) {
    const words = typeof c.outfitWords === 'string' ? c.outfitWords : '';
    const src = words || String(c.appearance || '');
    const o = outfitFromText(src, c);
    c.outfit = o ? { id: o.id, colour: '', fabric: '', text: words && !outfitIssue(words, c) ? words.slice(0, 160) : '' } : { id: 'custom', colour: '', fabric: '', text: words && !outfitIssue(words, c) ? words.slice(0, 160) : (isMinor(c) ? 'ordinary everyday clothes' : 'clothes as described in their look') };
  }
  delete c.outfitWords;
  if (!Array.isArray(c.wardrobe) || !c.wardrobe.length) c.wardrobe = [{ wid: 'w1', label: 'Main outfit', ...c.outfit }];
  return c;
}
// The catalogue as a short list for the writer (ids and names) for one character.
export const catalogueFor = c => outfitsFor(c).map(o => `${o.id}: ${o.name}`).join('\n');
