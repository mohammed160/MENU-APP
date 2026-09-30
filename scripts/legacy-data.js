/* =====================================================================
   DATA  –  single source of truth (edit prices / items here only)
   p = normal prices, s = cheese-stuffed prices  (M = Medium, L = Large, F = Family)
   img = photo cut from the original menu (images/pizza/<id>.png)
   ===================================================================== */
const SIZE_LABEL = { M:{en:'Medium',ar:'وسط'}, L:{en:'Large',ar:'كبير'}, F:{en:'Family',ar:'عائلي'} };

const PIZZAS = [
  {id:'z-burger',        en:'Z Burger Pizza',  ar:'زا برجر بيتزا',   p:{M:150,L:210,F:285}, s:{M:180,L:250,F:335}},
  {id:'super-beef',      en:'Super Beef',      ar:'سوبر بيف',        p:{M:140,L:205,F:280}, s:{M:170,L:245,F:330}},
  {id:'veggie',          en:'Veggie',          ar:'فيجن',            p:{M:110,L:155,F:210}, s:{M:140,L:195,F:260}},
  {id:'tuna',            en:'Tuna',            ar:'تونه',            p:{L:180},             s:{L:215}},
  {id:'shrimp',          en:'Shrimp',          ar:'جمبري',           p:{M:240,L:315,F:450}, s:{M:270,L:355,F:500}},
  {id:'sea-ranch',       en:'Sea Ranch',       ar:'سي رانش',         p:{M:270,L:350,F:490}, s:{M:300,L:390,F:540}},
  {id:'oh-pizza',        en:'Oh Pizza',        ar:'اوه بيتزا',       p:{M:120,L:150},       s:null},
  {id:'margarita',       en:'Margarita',       ar:'مارجريتا',        p:{M:90,L:125,F:190},  s:{M:120,L:165,F:240}},
  {id:'mix-cheese',      en:'Mix Cheese',      ar:'ميكس تشيز',       p:{M:115,L:160,F:230}, s:{M:145,L:200,F:280}},
  {id:'chicken-ranch',   en:'Chicken Ranch',   ar:'تشكن رانش',       p:{M:130,L:180,F:260}, s:{M:160,L:220,F:310}},
  {id:'chicken-bbq',     en:'Chicken BBQ',     ar:'تشكن باربيكيو',   p:{M:130,L:180,F:260}, s:{M:160,L:220,F:310}},
  {id:'crispy-chicken',  en:'Crispy Chicken',  ar:'كرسبي تشكن',      p:{M:135,L:190,F:275}, s:{M:165,L:230,F:325}},
  {id:'italian-sausage', en:'Italian Sausage', ar:'ايطاليان سوسيدج', p:{M:115,L:180,F:230}, s:{M:145,L:200,F:280}},
  {id:'pepperoni',       en:'Pepperoni',       ar:'ببروني',          p:{M:115,L:160,F:230}, s:{M:145,L:220,F:280}},
  {id:'pastrami',        en:'Pastrami',        ar:'بسطرمه',          p:{M:125,L:170,F:245}, s:{M:155,L:210,F:295}}
];

const PREMIUM_PIZZAS = [
  {id:'cheesy-crunch',  en:'Cheesy Crunch',  ar:'تشيز كرانش',  p:{Regular:240}, s:null},
  {id:'premium-cheese', en:'Premium Cheese', ar:'بريميم تشيز', p:{Regular:240}, s:null},
  {id:'chicken-pesto',  en:'Chicken Pesto',  ar:'تشكن بيستو',  p:{Regular:240}, s:null}
];

/* Pasta types offered on every pasta. To limit a dish, add  types:['penne']  to that item.
   Real pasta photos: drop  images/pasta/<id>.jpg  (or .png) and they replace the illustration automatically. */
const PASTA_TYPES = [
  {id:'penne',      en:'Penne',      ar:'بنه'},
  {id:'fettuccine', en:'Fettuccine', ar:'فوتوتشيني'}
];
const PASTA = [
  {id:'penne-arrabitta',       en:'Penne Arrabitta',       ar:'بنا ارابيتا',           p:{M:80,  L:100}, sauce:'#c8371f'},
  {id:'spaghetti-bolognese',   en:'Spaghetti Bolognese',   ar:'اسباجتي بونوليز',       p:{M:135, L:155}, sauce:'#a8391f'},
  {id:'oriental-sausage',      en:'Oriental Sausage Pasta',ar:'اورينتال سوسيدج باستا', p:{M:140, L:170}, sauce:'#b8571f'},
  {id:'mac-cheese',            en:'Mac & Cheese',          ar:'ماك اند تشيز',          p:{M:110, L:130}, sauce:'#f0b81f'},
  {id:'alfredo',               en:'Alfredo',               ar:'الفريدو',               p:{M:145, L:175}, sauce:'#f1e2b8'},
  {id:'chinese-chicken',       en:'Chinese Chicken Pasta', ar:'تشاينيز تشكن',          p:{M:155, L:185}, sauce:'#8a4a22'},
  {id:'crispy-chicken-pasta',  en:'Crispy Chicken Pasta',  ar:'كرسبي تشكن باستا',      p:{M:145, L:175}, sauce:'#ecd08f'},
  {id:'penne-pesto',           en:'Penne Pesto',           ar:'بنا بستو',              p:{M:160, L:190}, sauce:'#6f9a2e'},
  {id:'curry-shrimp',          en:'Curry Shrimp Pasta',    ar:'كاري باستا جمبري',      p:{M:265, L:320}, sauce:'#e0a21b'},
  {id:'chinese-shrimp',        en:'Chinese Shrimp Pasta',  ar:'تشاينيز شيرمب',         p:{M:275, L:330}, sauce:'#8a4a22'},
  {id:'seafood',               en:'Seafood',               ar:'سي فود',                p:{M:275, L:330}, sauce:'#d9583a'}
];
const PREMIUM_PASTA = [
  {id:'cordon-bleu', en:'Cordon Bleu Pasta', ar:'كوردون بلو باستا', p:{Regular:240}, sauce:'#f1e2b8'}
];

const SIDES_L  = [['Mozzarella Sticks',60],['Combo',55]];
const SIDES_HL = [['Coleslaw',40],['Chicken Salad',110],['Greek Salad',100]];
const SIDES_R  = [['Frise',40],['Cheese Frise',70],['Chili Frise',80],['Party Texas Fries',100],['Onion Rings',50],["Pub's Mix",185]];
const EXTRAS = [
  ['Grilled Chicken',40],['Beef Topping',40],['Jalapeño',20],['Cheese',40],
  ['Shrimp',90],['Pastrami',40],['Ranch',25],['Mix Cheese',50],
  ['Calamari',50],['Pepperoni',40],['BBQ',25],['Parmesan',60],
  ['Crabs',40],['Smoked Turkey',40],['Sweet Chili',25],['Roquefort',50],
  ['Mushroom',40],['Crispy Chicken',40],['Texas',25],['Cheddar Sauce',30]
];
const DRINKS = [['Soft Drink',20],['Water',15],['Soft Drink Liter',40]];
