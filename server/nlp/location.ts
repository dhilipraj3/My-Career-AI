// Indian location understanding: cities (tier 1–3, old names), states, "Pan India" / multi-location postings.

/** alias (lowercase) → canonical city. Includes former names and common spellings. */
export const CITY_ALIASES: Record<string, string> = {
  // Metros & tier 1
  bangalore: "Bengaluru", bengaluru: "Bengaluru", bengalooru: "Bengaluru", hyderabad: "Hyderabad", secunderabad: "Hyderabad", cyberabad: "Hyderabad",
  chennai: "Chennai", madras: "Chennai", mumbai: "Mumbai", bombay: "Mumbai", pune: "Pune", poona: "Pune", delhi: "Delhi", "new delhi": "Delhi",
  gurgaon: "Gurugram", gurugram: "Gurugram", noida: "Noida", "greater noida": "Greater Noida", kolkata: "Kolkata", calcutta: "Kolkata",
  ahmedabad: "Ahmedabad", "navi mumbai": "Navi Mumbai", thane: "Thane", faridabad: "Faridabad", ghaziabad: "Ghaziabad",
  // Tier 2
  jaipur: "Jaipur", kochi: "Kochi", cochin: "Kochi", ernakulam: "Kochi", coimbatore: "Coimbatore", chandigarh: "Chandigarh", mohali: "Mohali",
  panchkula: "Panchkula", indore: "Indore", trivandrum: "Thiruvananthapuram", thiruvananthapuram: "Thiruvananthapuram", nagpur: "Nagpur",
  lucknow: "Lucknow", mysore: "Mysuru", mysuru: "Mysuru", bhubaneswar: "Bhubaneswar", vadodara: "Vadodara", baroda: "Vadodara", surat: "Surat",
  visakhapatnam: "Visakhapatnam", vizag: "Visakhapatnam", madurai: "Madurai", bhopal: "Bhopal", patna: "Patna", ranchi: "Ranchi", raipur: "Raipur",
  guwahati: "Guwahati", dehradun: "Dehradun", ludhiana: "Ludhiana", amritsar: "Amritsar", jalandhar: "Jalandhar", kanpur: "Kanpur", agra: "Agra",
  varanasi: "Varanasi", benares: "Varanasi", banaras: "Varanasi", prayagraj: "Prayagraj", allahabad: "Prayagraj", meerut: "Meerut", nashik: "Nashik",
  aurangabad: "Chhatrapati Sambhajinagar", "chhatrapati sambhajinagar": "Chhatrapati Sambhajinagar", rajkot: "Rajkot", gandhinagar: "Gandhinagar",
  jodhpur: "Jodhpur", udaipur: "Udaipur", kota: "Kota", ajmer: "Ajmer", vijayawada: "Vijayawada", guntur: "Guntur", tirupati: "Tirupati",
  nellore: "Nellore", warangal: "Warangal", mangalore: "Mangaluru", mangaluru: "Mangaluru", hubli: "Hubballi", hubballi: "Hubballi",
  dharwad: "Dharwad", belgaum: "Belagavi", belagavi: "Belagavi", davangere: "Davanagere", davanagere: "Davanagere", shimoga: "Shivamogga",
  shivamogga: "Shivamogga", tumkur: "Tumakuru", tumakuru: "Tumakuru", manipal: "Manipal", udupi: "Udupi", salem: "Salem", trichy: "Tiruchirappalli",
  tiruchirappalli: "Tiruchirappalli", tirunelveli: "Tirunelveli", erode: "Erode", tiruppur: "Tiruppur", vellore: "Vellore", hosur: "Hosur",
  pondicherry: "Puducherry", puducherry: "Puducherry", kozhikode: "Kozhikode", calicut: "Kozhikode", thrissur: "Thrissur", kollam: "Kollam",
  kannur: "Kannur", kottayam: "Kottayam", goa: "Goa", panaji: "Panaji", margao: "Margao", "vasco da gama": "Vasco da Gama", jammu: "Jammu",
  srinagar: "Srinagar", shimla: "Shimla", haridwar: "Haridwar", rishikesh: "Rishikesh", jamshedpur: "Jamshedpur", dhanbad: "Dhanbad",
  cuttack: "Cuttack", rourkela: "Rourkela", siliguri: "Siliguri", durgapur: "Durgapur", asansol: "Asansol", howrah: "Howrah", gwalior: "Gwalior",
  jabalpur: "Jabalpur", ujjain: "Ujjain", bilaspur: "Bilaspur", bhilai: "Bhilai", sonipat: "Sonipat", panipat: "Panipat", karnal: "Karnal",
  rohtak: "Rohtak", hisar: "Hisar", ambala: "Ambala", bareilly: "Bareilly", aligarh: "Aligarh", moradabad: "Moradabad", gorakhpur: "Gorakhpur",
  jhansi: "Jhansi", solapur: "Solapur", kolhapur: "Kolhapur", sangli: "Sangli", amravati: "Amravati", akola: "Akola", jalgaon: "Jalgaon",
  bhiwandi: "Bhiwandi", "vasai virar": "Vasai-Virar", vasai: "Vasai-Virar", virar: "Vasai-Virar", kalyan: "Kalyan", "pimpri chinchwad": "Pimpri-Chinchwad",
  "pimpri-chinchwad": "Pimpri-Chinchwad", chakan: "Chakan", sriperumbudur: "Sriperumbudur", "sri city": "Sri City", bharuch: "Bharuch",
  vapi: "Vapi", jamnagar: "Jamnagar", bhavnagar: "Bhavnagar", mehsana: "Mehsana", silvassa: "Silvassa", daman: "Daman", imphal: "Imphal",
  shillong: "Shillong", agartala: "Agartala", aizawl: "Aizawl", kohima: "Kohima", itanagar: "Itanagar", gangtok: "Gangtok", "port blair": "Port Blair",
  leh: "Leh", bathinda: "Bathinda", patiala: "Patiala", "sri ganganagar": "Sri Ganganagar", bikaner: "Bikaner", alwar: "Alwar", neemrana: "Neemrana",
  bhiwadi: "Bhiwadi", manesar: "Manesar", rudrapur: "Rudrapur", haldwani: "Haldwani", muzaffarpur: "Muzaffarpur", bhagalpur: "Bhagalpur",
  "bokaro": "Bokaro", "kakinada": "Kakinada", "rajahmundry": "Rajahmundry", "anantapur": "Anantapur", "kurnool": "Kurnool", "karimnagar": "Karimnagar",
  "nizamabad": "Nizamabad", "khammam": "Khammam", "thanjavur": "Thanjavur", "kanchipuram": "Kanchipuram", "nagercoil": "Nagercoil", "karur": "Karur",
};

/** Canonical state/UT names with aliases. */
const STATE_ALIASES: Record<string, string> = {
  "andhra pradesh": "Andhra Pradesh", "arunachal pradesh": "Arunachal Pradesh", assam: "Assam", bihar: "Bihar", chhattisgarh: "Chhattisgarh",
  goa: "Goa", gujarat: "Gujarat", haryana: "Haryana", "himachal pradesh": "Himachal Pradesh", jharkhand: "Jharkhand", karnataka: "Karnataka",
  kerala: "Kerala", "madhya pradesh": "Madhya Pradesh", maharashtra: "Maharashtra", manipur: "Manipur", meghalaya: "Meghalaya", mizoram: "Mizoram",
  nagaland: "Nagaland", odisha: "Odisha", orissa: "Odisha", punjab: "Punjab", rajasthan: "Rajasthan", sikkim: "Sikkim", "tamil nadu": "Tamil Nadu",
  tamilnadu: "Tamil Nadu", telangana: "Telangana", tripura: "Tripura", "uttar pradesh": "Uttar Pradesh", uttarakhand: "Uttarakhand",
  "west bengal": "West Bengal", "jammu and kashmir": "Jammu and Kashmir", "j&k": "Jammu and Kashmir", ladakh: "Ladakh", "delhi ncr": "Delhi NCR",
  ncr: "Delhi NCR", "andaman and nicobar": "Andaman and Nicobar Islands", "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compile = (m: Record<string, string>) =>
  Object.keys(m).sort((a, b) => b.length - a.length).map((k) => [k, new RegExp(`(^|[^a-z])${escape(k)}([^a-z]|$)`, "i")] as const);
const CITY_RES = compile(CITY_ALIASES);
const STATE_RES = compile(STATE_ALIASES);

const PAN_INDIA = /\b(pan[- ]?india|across india|all over india|anywhere in india|multiple (cities|locations)|various locations|all india)\b/i;

export function canonicalCity(name: string): string {
  const k = name.trim().toLowerCase();
  return CITY_ALIASES[k] || name.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All Indian cities mentioned, in order of first appearance, canonicalised and de-duplicated. */
export function findIndianCities(text: string): string[] {
  const hits: Array<[number, string]> = [];
  let rest = text;
  for (const [k, re] of CITY_RES) {
    const m = rest.match(re);
    if (!m) continue;
    hits.push([m.index!, CITY_ALIASES[k]]);
    // Blank the match so "navi mumbai" doesn't also count as "mumbai".
    rest = rest.slice(0, m.index!) + " ".repeat(m[0].length) + rest.slice(m.index! + m[0].length);
  }
  return [...new Set(hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]))];
}

export function findIndianStates(text: string): string[] {
  const out = new Set<string>();
  for (const [k, re] of STATE_RES) if (re.test(text)) out.add(STATE_ALIASES[k]);
  return [...out];
}

const COUNTRIES = ["india", "united states", "usa", "united kingdom", "uk", "germany", "canada", "singapore", "australia", "ireland", "netherlands", "france", "uae", "united arab emirates", "japan", "china", "philippines", "poland", "spain", "mexico", "brazil", "israel", "sweden", "switzerland", "türkiye", "turkey"];

export interface ParsedLocation {
  city: string; // first/primary city
  cities: string[]; // every Indian city named
  state: string;
  country: string;
  remote: boolean;
  india: boolean;
  panIndia: boolean;
}

export function parseLocation(raw: string, remoteHint = false): ParsedLocation {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();
  const cities = findIndianCities(text);
  const states = findIndianStates(text);
  const panIndia = PAN_INDIA.test(text);
  const remote = remoteHint || /\b(remote|work from home|wfh|anywhere|distributed)\b/.test(lower);
  const mentionsIndia = /\bindia\b|\bbharat\b|(^|[^a-z])in$/i.test(lower) || cities.length > 0 || states.length > 0 || panIndia;
  let country = mentionsIndia ? "India" : "";
  if (!country) {
    const c = COUNTRIES.find((x) => new RegExp(`\\b${x}\\b`).test(lower));
    if (c) country = c === "usa" ? "United States" : c === "uk" ? "United Kingdom" : c.replace(/\b\w/g, (m) => m.toUpperCase());
  }
  let city = cities[0] || "";
  // Unknown non-Indian place ("Austin, Texas"): keep its first segment as the city label.
  if (!city && text && !remote && !panIndia && !states.length && !mentionsIndia) city = text.split(/[,;/|]/)[0].trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
  return { city, cities, state: states[0] || "", country, remote, india: mentionsIndia, panIndia };
}
