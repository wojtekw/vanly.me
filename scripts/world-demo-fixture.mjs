// Synthetic local-only fixture. No real contacts or identity-document numbers.
import crypto from 'node:crypto';

export const WORLD_DEMO_VERSION = 'vanly-world-demo-v1';
export const EXISTING_DEMO_COMPANY_IDS = ['baltic', 'slow-roads', 'pod-gore', 'lesna-baza', 'weekend-dalej', 'morski-szlak', 'zakret-lodz', 'jurajski-postoj', 'nad-wisla-vans', 'vani-mazovia', 'sudecka-droga', 'mazurski-horyzont'];
export const travelerEmail = (n) => `podroznik${String(n).padStart(3, '0')}@demo.vanly.local`;
export const stableUuid = (value) => {
  const hex = crypto.createHash('sha256').update(WORLD_DEMO_VERSION + ':' + value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
function rng(seed) {
  let state = Number.parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16);
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const cities = [
  ['Warszawa',52.2297,21.0122],['Kraków',50.0647,19.9450],['Gdańsk',54.3520,18.6466],['Poznań',52.4064,16.9252],['Wrocław',51.1079,17.0385],['Łódź',51.7592,19.4560],['Szczecin',53.4285,14.5528],['Lublin',51.2465,22.5684],['Bydgoszcz',53.1235,18.0084],['Katowice',50.2649,19.0238],['Białystok',53.1325,23.1688],['Toruń',53.0138,18.5984],['Olsztyn',53.7784,20.4801],['Rzeszów',50.0412,21.9991],['Kielce',50.8661,20.6286],['Opole',50.6751,17.9213],['Gorzów Wielkopolski',52.7368,15.2288],['Zielona Góra',51.9356,15.5062],['Bielsko-Biała',49.8224,19.0444],['Nowy Sącz',49.6175,20.7153],['Jelenia Góra',50.9044,15.7194],['Kołobrzeg',54.1761,15.5769],['Suwałki',54.1115,22.9308],['Siedlce',52.1676,22.2902],['Kalisz',51.7611,18.0910],['Gdynia',54.5189,18.5305],['Piła',53.1510,16.7378],['Słupsk',54.4641,17.0287],['Tarnów',50.0121,20.9858],['Częstochowa',50.8118,19.1203],
];
const male = ['Adam','Bartosz','Damian','Filip','Grzegorz','Hubert','Igor','Jan','Jakub','Kamil','Karol','Krzysztof','Łukasz','Maciej','Marcin','Mateusz','Michał','Paweł','Piotr','Robert','Szymon','Tomasz','Wojciech'];
const female = ['Agnieszka','Aleksandra','Anna','Barbara','Dominika','Ewa','Gabriela','Hanna','Iga','Joanna','Julia','Karolina','Katarzyna','Kinga','Magdalena','Maja','Marta','Monika','Natalia','Olga','Paulina','Weronika','Zofia'];
const lastNames = ['Nowak','Wójcik','Mazur','Kaczmarek','Zając','Król','Pawlak','Dudek','Wróbel','Jabłoński','Kamiński','Lewandowski','Kowalski','Sokołowski','Wiśniewski','Kozłowski','Jankowski','Górski','Adamczyk','Czarnecki','Witkowski','Piotrowski','Zieliński','Malinowski','Kubiak','Lis'];
const pick = (random, values) => values[Math.floor(random() * values.length)];
const range = (random, min, max) => min + Math.floor(random() * (max - min + 1));
function syntheticName(random) {
  const isFemale = random() < .5;
  const first = pick(random, isFemale ? female : male);
  let last = pick(random, lastNames);
  if (isFemale && /ski$/.test(last)) last = last.slice(0, -1) + 'a';
  return `${first} ${last}`;
}
export function person(n, name) {
  const random = rng('person:' + n);
  name ||= syntheticName(random);
  const [homeCity] = pick(random, cities);
  const birthDate = `${range(random,1962,2002)}-${String(range(random,1,12)).padStart(2,'0')}-${String(range(random,1,28)).padStart(2,'0')}`;
  const drivingYears = (date) => {
    const birthday=new Date(date+'T00:00:00Z'),reference=new Date('2026-10-07T10:00:00Z');
    const age=reference.getUTCFullYear()-birthday.getUTCFullYear()-(reference.getUTCMonth()<birthday.getUTCMonth()||(reference.getUTCMonth()===birthday.getUTCMonth()&&reference.getUTCDate()<birthday.getUTCDate())?1:0);
    return range(random,2,Math.min(25,age-18));
  };
  const address = { street: `ul. ${pick(random,['Demonstracyjna','Testowa','Fikcyjna','Przykładowa'])}`, houseNumber: String(range(random,1,200)), apartment: random() < .65 ? String(range(random,1,80)) : '', postalCode: '00-000', city: homeCity, country: 'Polska', fictional: true };
  const drivers = [{ name, country: 'Polska', licenseCategory: 'B', birthDate, syntheticReference: `DEMO-DRIVER-${String(n).padStart(4,'0')}`, experienceYears: drivingYears(birthDate) }];
  if (random() < .24) {
    const secondBirthDate=`${range(random,1962,2002)}-05-15`;
    drivers.push({ name: syntheticName(random), country: 'Polska', licenseCategory: 'B', birthDate: secondBirthDate, syntheticReference: `DEMO-DRIVER-${String(n).padStart(4,'0')}-B`, experienceYears: drivingYears(secondBirthDate) });
  }
  return { name, profile: { name, phone: `+48 000 ${String(n % 1000000).padStart(6,'0')}`, drivers, marketing: random() < .25, homeCity, birthDate, address, preferredLanguage: 'pl', emergencyContact: { name: syntheticName(random), phone: `+48 000 ${String((n+41000)%1000000).padStart(6,'0')}`, relationship: pick(random,['partner','rodzeństwo','przyjaciel']) }, preferences: { travelers: range(random,1,5), pets: random() < .32, preferredVehicleType: pick(random,['campervan','semi','alcove','offroad']), destinations: [pick(random,['Mazury','Bałtyk','Bieszczady','Sudety','Jura Krakowsko-Częstochowska','Podlasie']),pick(random,['Czechy','Słowacja','Niemcy','Chorwacja','Norwegia'])], travelStyle: pick(random,['rodzinny','weekendowy','aktywny','spokojny','praca w podróży']) }, demo: true, demoVersion: WORLD_DEMO_VERSION, syntheticDataNote: 'Fikcyjne konto lokalne. Telefon, adres i referencje kierowców są danymi demonstracyjnymi.' } };
}
const adjectives = ['Bursztynowy','Leśny','Słoneczny','Zielony','Spokojny','Daleki','Wolny','Północny','Południowy','Górski','Mazurski','Miejski','Błękitny','Srebrny','Złoty','Wędrowny','Radosny','Otwarty','Nowy','Letni','Poranny','Jesienny'];
const nouns = ['Horyzont','Szlak','Postój','Kompas','Trakt','Kierunek','Wyjazd','Przystanek','Azyl','Prąd','Brzeg','Start','Rytm','Wiatr','Widok','Zakątek','Zaułek','Obóz','Plan','Nurt','Dukt','Ślad'];
export function companyDetails(company, index, fleetSize) {
  const random = rng('company:' + company.id);
  const city = company.city;
  return { minDays: 2 + index % 4, buffer: index % 4 === 0 ? 0 : 1, prep: (150 + index % 7 * 25) * 100, open: index % 3 === 0 ? '08:00' : '09:00', close: index % 4 === 0 ? '18:00' : '17:00', demo: true, demoVersion: WORLD_DEMO_VERSION, contact: { email: `kontakt.${company.id}@demo.vanly.local`, phone: `+48 000 ${String(600000+index).padStart(6,'0')}`, website: `https://${company.id}.example.invalid`, contactPerson: syntheticName(random) }, address: { street: 'ul. Demonstracyjna', houseNumber: String(10+index), postalCode: '00-000', city, country: 'Polska', fictional: true }, billingAddress: { street: 'ul. Testowa', houseNumber: String(10+index), postalCode: '00-000', city, country: 'Polska', fictional: true }, description: `Fikcyjna wypożyczalnia ${company.name} w mieście ${city}. ${fleetSize > 1 ? 'Nasza flota obejmuje pojazdy na rodzinne wakacje, krótkie wyjazdy i spokojne podróże.' : 'Prowadzimy kameralną wypożyczalnię jednego pojazdu, przygotowanego do indywidualnych podróży.'} Oferujemy odbiór po instruktażu, wyposażenie z własnego magazynu i wsparcie na trasie. Dane służą prezentacji lokalnego portalu VANLY.`, pickupInstructions: 'Odbiór w demonstracyjnym punkcie po wcześniejszym uzgodnieniu godziny. Instruktaż trwa około 45 minut.', returnInstructions: 'Przy zwrocie uzupełnij paliwo i opróżnij zbiorniki. Oględziny przeprowadzamy wspólnie.', supportedLanguages: index % 3 ? ['pl','en'] : ['pl','en','de'], minimumDriverAge: 23, minimumLicenseYears: 2, cancellationPolicy: 'Lokalna konfiguracja testowa: anulowanie przed odbiorem oznacza pełny zwrot płatności testowej. Zmiana terminu wymaga dostępności pojazdu i akceptacji wypożyczalni.', bankAccountReference: `DEMO-BANK-${String(index+1).padStart(4,'0')}`, registrationReference: `DEMO-COMPANY-${String(index+1).padStart(4,'0')}`, syntheticDataNote: 'Fikcyjna firma testowa. Adresy i dane kontaktowe są demonstracyjne.' };
}
const types = {
  campervan: { asset:'campervan.webp',seats:4,sleeps:4,names:['Volkswagen California Ocean','Ford Transit Custom Nugget','Mercedes Marco Polo','Renault Trafic SpaceNomad'],features:['Kuchnia z lodówką','Podnoszony dach','Ogrzewanie postojowe','Gniazda USB','Stolik turystyczny'],base:33900,tagline:'Zwinny na trasie i przytulny na postoju.' },
  semi: { asset:'semi.webp',seats:4,sleeps:4,names:['Adria Matrix 670 SL','Benimar Tessoro 463','Chausson 640','Sunlight T68'],features:['Prysznic i toaleta','Kuchnia z lodówką','Ogrzewanie','Markiza','Bagażnik rowerowy'],base:45900,tagline:'Wygodna przestrzeń na spokojną podróż.' },
  alcove: { asset:'alcove.webp',seats:6,sleeps:6,names:['Roller Team Kronos 284 M','Benimar Sport 323','Sunlight A70','Dethleffs Trend A'],features:['Alkowa','Prysznic i toaleta','Kuchnia z lodówką','Ogrzewanie','Duży bagażnik'],base:50900,tagline:'Więcej miejsca dla całej rodziny.' },
  offroad: { asset:'offroad.webp',seats:4,sleeps:2,names:['Karmann Dexter 560 4x4','Volkswagen California 4Motion','Hymer Grand Canyon S 4x4','Ford Transit Adventure AWD'],features:['Napęd 4×4','Kuchnia z lodówką','Ogrzewanie postojowe','Panel słoneczny','Markiza'],base:48900,tagline:'Własny rytm podróży blisko natury.' },
};
const equipment = [
  ['chair','Krzesło turystyczne',500,'day',[]],['seat','Fotelik dziecięcy',2000,'day',[]],['linen','Komplet pościeli',7900,'trip',[]],['bike','Bagażnik na rowery',2500,'day',['trailer']],['table','Stół turystyczny',1000,'day',[]],['kitchen-kit','Zestaw naczyń i garnków',4900,'trip',[]],['bbq','Grill turystyczny',6900,'trip',[]],['sup','Deska SUP z wiosłem',4500,'day',[]],['power-station','Przenośna stacja zasilania',5900,'day',[]],['gps','Nawigacja turystyczna',1200,'day',[]],
];
export function stockFixture(company, index, fleetSize) {
  return equipment.slice(0,6+index%5).map(([id,name,price,unit,excluded_types], k) => ({ company_id:company.id,id,name,quantity: Math.max(4,fleetSize * (id === 'chair' || id === 'linen' ? 4 : 2)) + index % 3,price: price + (index % 5) * (unit==='day'?100:500),unit,excluded_types }));
}
export function seasonFixture(vehicle) {
  return [2026,2027,2028].flatMap(year => [
    [`${year}-01-01`,`${year}-04-01`,.8,'niski'],[`${year}-04-01`,`${year}-06-15`,1,'średni'],[`${year}-06-15`,`${year}-09-01`,1.22,'wysoki'],[`${year}-09-01`,`${year}-11-01`,1,'średni'],[`${year}-11-01`,`${year+1}-01-01`,.8,'niski'],
  ].map(([start_date,end_date,factor,label]) => ({id:stableUuid(`season:${vehicle.id}:${start_date}`),company_id:vehicle.company_id,vehicle_id:vehicle.id,start_date,end_date,rate:Math.round(vehicle.daily*factor/100)*100,name:`DEMO · sezon ${label} ${year}`})));
}
export function buildWorldFixture() {
  const companies = [], vehicles = [], owners = [], travelers = [];
  for (let i=0;i<138;i++) {
    const multi = i < 22;
    const n = multi ? i+1 : i-21;
    const size = multi ? 2+i%8 : 1;
    const id = `demo-${multi?'flota':'solo'}-${String(n).padStart(3,'0')}`;
    const [city,lat,lng] = cities[i%cities.length];
    const name = `${adjectives[i%adjectives.length]} ${nouns[Math.floor(i/adjectives.length)%nouns.length]} ${city}`;
    const company = {id,name,city,lat,lng,verified:true};
    company.settings = companyDetails(company,i+12,size);
    companies.push(company);
    const owner = person(10000+i);
    owners.push({email:`wlasciciel.${id}@demo.vanly.local`,name:owner.name,role:'owner',company_id:id,profile:{...owner.profile,position:'Właściciel wypożyczalni',companyName:name}});
    for(let k=0;k<size;k++) {
      const type = Object.keys(types)[(i+k)%4], defaults=types[type];
      const model=defaults.names[Math.floor((i+k)/4)%defaults.names.length];
      const vehicleId = `${id}-auto-${String(k+1).padStart(2,'0')}`;
      vehicles.push({ id:vehicleId,company_id:id,name:`${model} · ${pick(rng(vehicleId),['Amber','Forest','Ocean','Sunny','Trail','River','Peak','Breeze'])} ${String(k+1).padStart(2,'0')}`,type,asset:defaults.asset,city,street:'ul. Demonstracyjna',house_number:String(22+i),lat:lat+(k%3)*.0015,lng:lng+(k%4)*.0015,seats:defaults.seats,sleeps:defaults.sleeps,daily:defaults.base+(i%8)*1500,prep:company.settings.prep,deposit:(3000+i%6*500)*100,min_days:company.settings.minDays,auto:(i+k)%3!==0,pets:(i+k)%4!==0,instant:(i+k)%3!==1,km:250+(i%4)*50,features:[...defaults.features,...((i+k)%3===0?['Klimatyzacja kabiny']:[])],description:`${model} z fikcyjnej floty ${name}. Komfortowa konfiguracja dla ${defaults.sleeps} osób, przygotowana kuchnia i ogrzewanie ułatwiają podróż niezależnie od pogody. Instruktaż przed wyjazdem i dodatkowe wyposażenie dostępne w magazynie. Oferta demonstracyjna, służy testowaniu portalu.`,tagline:defaults.tagline,status:'published' });
    }
  }
  for(let n=1;n<=1000;n++) {
    const p=person(n);
    travelers.push({email:travelerEmail(n),name:p.name,role:'traveler',company_id:null,profile:p.profile});
  }
  return { version:WORLD_DEMO_VERSION,fictional:true,companies,vehicles,owners,travelers,newTravelerCount:900,newVehicleCount:vehicles.length,newCompanyCount:companies.length };
}
