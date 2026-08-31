import type { Locale } from './types';

// The public introduction is content-driven so NL and FR cannot drift apart: every entry
// below must exist in both languages, and a test asserts that.
export type GuideShot = { src: string; width: number; height: number; title: Record<Locale, string>; body: Record<Locale, string>; alt: Record<Locale, string> };

export const guideDocument = {
  href: '/docs/BusApp_Registratie_Eerste_Stappen.pdf',
  // The guide itself is written in Dutch; the app interface is NL/FR. Say so honestly.
  language: 'NL',
  pages: 13,
};

export const publicCopy = {
  navHowItWorks: { nl: 'Hoe werkt het', fr: 'Comment ça marche' },
  navParents: { nl: 'Voor ouders', fr: 'Pour les parents' },
  navPrivacy: { nl: 'Privacy', fr: 'Confidentialité' },
  navGuide: { nl: 'Handleiding', fr: 'Guide' },

  heroTitle: { nl: 'De gratis busapp voor chauffeur, begeleider en ouder.', fr: "L'application de bus gratuite pour le conducteur, l'accompagnateur et les parents." },
  heroBody: {
    nl: 'Plan je haltes, bereid je route voor en laat ouders eenvoudig volgen wanneer de bus eraan komt.',
    fr: "Préparez vos arrêts, organisez votre itinéraire et permettez aux parents de suivre simplement l'arrivée du bus.",
  },
  ctaStart: { nl: 'Gratis starten', fr: 'Commencer gratuitement' },
  ctaParent: { nl: 'Ik ben ouder', fr: 'Je suis parent' },
  ctaSignIn: { nl: 'Aanmelden', fr: 'Se connecter' },

  badgeLanguages: { nl: 'Nederlands / Français', fr: 'Nederlands / Français' },
  badgeCountry: { nl: 'België', fr: 'Belgique' },
  badgeMobile: { nl: 'Mobiel & PWA', fr: 'Mobile & PWA' },
  badgePrivacy: { nl: 'Privacygericht', fr: 'Axé sur la confidentialité' },
  badgeFree: { nl: 'Gratis', fr: 'Gratuit' },

  whatTitle: { nl: 'Wat is BusApp?', fr: "Qu'est-ce que BusApp ?" },
  whatBody: {
    nl: 'BusApp helpt je een busrit overzichtelijk te organiseren. Je maakt je bus aan, voegt haltes en passagiers toe en bereidt je route voor. Ouders krijgen een eigen, beperkte toegang tot de informatie die voor hun busrit nodig is.',
    fr: "BusApp vous aide à organiser clairement un trajet en bus. Vous créez votre bus, ajoutez les arrêts et les passagers et préparez votre itinéraire. Les parents reçoivent leur propre accès limité aux informations nécessaires à leur trajet.",
  },

  promiseTitle: { nl: 'Volg de bus, niet de kinderen.', fr: 'Suivez le bus, pas les enfants.' },
  promiseBody: {
    nl: 'BusApp volgt de bus. Ouders krijgen alleen de informatie te zien die voor hun eigen busrit relevant is.',
    fr: "BusApp suit le bus. Les parents ne voient que les informations nécessaires pour leur propre trajet.",
  },

  howTitle: { nl: 'Hoe werkt het?', fr: 'Comment ça marche ?' },
  steps: [
    { nl: { title: 'Maak je bus aan', body: 'Geef je bus een naam en een herkenbare avatar of foto.' }, fr: { title: 'Créez votre bus', body: 'Donnez un nom à votre bus et choisissez un avatar ou une photo reconnaissable.' } },
    { nl: { title: 'Voeg haltes toe', body: 'Voeg de adressen toe waar je passagiers worden opgehaald of afgezet.' }, fr: { title: 'Ajoutez les arrêts', body: 'Ajoutez les adresses où vos passagers montent ou descendent.' } },
    { nl: { title: 'Bereid je rit voor', body: 'BusApp helpt je de route en de volgorde van de haltes voor te bereiden.' }, fr: { title: 'Préparez votre trajet', body: "BusApp vous aide à préparer l'itinéraire et l'ordre des arrêts." } },
    { nl: { title: 'Deel oudertoegang', body: 'Een ouder krijgt een veilige code en ziet alleen de informatie die voor zijn of haar passagier nodig is.' }, fr: { title: "Partagez l'accès parent", body: "Le parent reçoit un code sécurisé et ne voit que les informations nécessaires à son passager." } },
  ],

  staffTitle: { nl: 'Voor chauffeur & begeleider', fr: "Pour le conducteur & l'accompagnateur" },
  staffBody: { nl: 'Alles wat je tijdens de busrit nodig hebt, op één eenvoudige plek.', fr: "Tout ce dont vous avez besoin pendant le trajet, à un seul endroit simple." },
  staffPoints: [
    { nl: 'bus en haltes beheren', fr: 'gérer le bus et les arrêts' },
    { nl: 'passagiers koppelen', fr: 'associer les passagers' },
    { nl: 'route voorbereiden', fr: "préparer l'itinéraire" },
    { nl: 'volgende halte zien', fr: "voir le prochain arrêt" },
    { nl: 'passagier opgestapt of afwezig registreren', fr: 'enregistrer un passager monté ou absent' },
    { nl: 'oudercodes beheren', fr: 'gérer les codes parents' },
  ],

  parentTitle: { nl: 'Voor ouders', fr: 'Pour les parents' },
  parentBody: { nl: 'Geen ingewikkeld account. Je krijgt een persoonlijke buscode van de chauffeur of begeleider.', fr: "Pas de compte compliqué. Vous recevez un code bus personnel du conducteur ou de l'accompagnateur." },
  parentPoints: [
    { nl: 'jouw gekoppelde passagier', fr: 'votre passager associé' },
    { nl: 'jouw halte', fr: 'votre arrêt' },
    { nl: 'de relevante bus', fr: 'le bus concerné' },
    { nl: 'aankomstinformatie', fr: "les informations d'arrivée" },
    { nl: 'veilige businformatie', fr: 'les informations sécurisées du bus' },
  ],
  parentTrustTitle: { nl: 'Geen tracking van je kind.', fr: 'Pas de suivi de votre enfant.' },
  parentTrustBody: { nl: 'BusApp volgt de bus, niet de telefoon van het kind of de ouder.', fr: "BusApp suit le bus, pas le téléphone de l'enfant ou du parent." },

  journeyTitle: { nl: 'Zo ziet BusApp eruit', fr: 'À quoi ressemble BusApp' },

  busProfileTitle: { nl: 'Geef je bus een gezicht', fr: 'Donnez un visage à votre bus' },
  busProfileBody: { nl: 'Kies een BusApp-avatar of upload een foto van de echte bus. Zo herkennen ouders makkelijker welke bus ze volgen.', fr: "Choisissez un avatar BusApp ou importez une photo du vrai bus. Les parents reconnaissent ainsi plus facilement le bus qu'ils suivent." },
  profileTitle: { nl: 'Persoonlijke en herkenbare profielen', fr: 'Des profils personnels et reconnaissables' },
  profileBody: { nl: 'Chauffeurs, begeleiders, ouders en passagiers kunnen een BusApp-avatar gebruiken. Een eigen foto blijft optioneel en wordt privé bewaard.', fr: "Les conducteurs, accompagnateurs, parents et passagers peuvent utiliser un avatar BusApp. Une photo personnelle reste facultative et est conservée de manière privée." },

  privacyTitle: { nl: 'Privacy vanaf het ontwerp', fr: 'La confidentialité dès la conception' },
  privacyBody: { nl: 'BusApp is opgebouwd om zo weinig mogelijk persoonlijke informatie nodig te hebben.', fr: "BusApp est conçu pour avoir besoin du minimum d'informations personnelles." },
  privacyPoints: [
    { nl: 'geen GPS-tracking van kinderen', fr: 'pas de suivi GPS des enfants' },
    { nl: 'geen GPS-tracking van ouders', fr: 'pas de suivi GPS des parents' },
    { nl: 'ouders zien geen andere gezinnen', fr: 'les parents ne voient pas les autres familles' },
    { nl: 'toegang via een beperkte oudercontext', fr: 'accès via un contexte parent limité' },
    { nl: "foto's zijn optioneel", fr: 'les photos sont facultatives' },
    { nl: 'operationele toegang wordt server-side gecontroleerd', fr: "l'accès opérationnel est contrôlé côté serveur" },
  ],
  storageTitle: { nl: 'Technische opslag', fr: 'Stockage technique' },
  storageBody: {
    nl: 'BusApp gebruikt PostgreSQL via Supabase voor de gegevens die nodig zijn om de dienst te laten werken. Toegang wordt beperkt tot de functies en gebruikers die deze informatie daadwerkelijk nodig hebben.',
    fr: "BusApp utilise PostgreSQL via Supabase pour les données nécessaires au fonctionnement du service. L'accès est limité aux fonctions et aux utilisateurs qui ont réellement besoin de ces informations.",
  },
  gdprBody: {
    nl: 'BusApp is ontworpen volgens de privacy- en dataminimalisatieprincipes van de GDPR/AVG. Concrete GDPR-verplichtingen hangen ook af van de verwerking, rollen en organisatorische maatregelen in de praktijk.',
    fr: "BusApp est conçu selon les principes de confidentialité et de minimisation des données du RGPD. Les obligations concrètes dépendent aussi du traitement, des rôles et des mesures organisationnelles mises en place.",
  },

  guideTitle: { nl: 'Hulp nodig?', fr: "Besoin d'aide ?" },
  guideHeading: { nl: 'Registratie & eerste stappen', fr: 'Inscription & premiers pas' },
  guideBody: {
    nl: 'Een visuele handleiding voor chauffeurs en begeleiders: van account tot busprofiel, haltes, route, passagiers en profielinstellingen.',
    fr: "Un guide visuel pour les conducteurs et accompagnateurs : du compte au profil du bus, aux arrêts, à l'itinéraire, aux passagers et aux réglages du profil.",
  },
  guideOpen: { nl: 'Handleiding openen', fr: 'Ouvrir le guide' },
  guideMeta: { nl: "PDF · 13 pagina's · Nederlands", fr: 'PDF · 13 pages · en néerlandais' },

  freeTitle: { nl: 'Gratis starten', fr: 'Commencer gratuitement' },
  freeBody: { nl: 'BusApp is bedoeld als een eenvoudige, toegankelijke busapp. Je hebt geen abonnement nodig om je eerste bus aan te maken.', fr: "BusApp se veut une application de bus simple et accessible. Aucun abonnement n'est nécessaire pour créer votre premier bus." },

  contactTitle: { nl: 'Contact', fr: 'Contact' },
  footerTagline: { nl: 'Gratis busapp voor eenvoudige, veilige busritten.', fr: 'Application de bus gratuite pour des trajets simples et sûrs.' },
} as const;

// The visual journey follows the guide: access, registration, bus, route, passengers,
// profiles, privacy. Screenshots are the real product, unmodified.
export const guideShots: GuideShot[] = [
  { src: '/media/guide/4327.jpg', width: 658, height: 1536,
    title: { nl: 'Kies je toegang', fr: 'Choisissez votre accès' },
    body: { nl: 'Chauffeurs en begeleiders gebruiken één toegang, ouders een aparte.', fr: "Les conducteurs et accompagnateurs utilisent un accès, les parents un autre." },
    alt: { nl: 'BusApp startscherm met keuze tussen buspersoneel en ouder.', fr: "Écran d'accueil BusApp avec le choix entre personnel du bus et parent." } },
  { src: '/media/guide/4329.jpg', width: 658, height: 1536,
    title: { nl: 'Gratis registreren', fr: 'Inscription gratuite' },
    body: { nl: 'Voornaam, e-mailadres en wachtwoord. Meer is er niet nodig.', fr: 'Prénom, adresse e-mail et mot de passe. Rien de plus.' },
    alt: { nl: 'BusApp registratiescherm voor chauffeur of begeleider.', fr: "Écran d'inscription BusApp pour conducteur ou accompagnateur." } },
  { src: '/media/guide/4331.jpg', width: 658, height: 1536,
    title: { nl: 'Maak je eerste bus', fr: 'Créez votre premier bus' },
    body: { nl: 'Geef de bus een naam, kies het type, het aantal plaatsen en het startadres.', fr: "Nommez le bus, choisissez le type, le nombre de places et l'adresse de départ." },
    alt: { nl: 'BusApp scherm om een eerste bus en startadres aan te maken.', fr: "Écran BusApp pour créer un premier bus et son adresse de départ." } },
  { src: '/media/guide/4333.jpg', width: 658, height: 1536,
    title: { nl: 'Je bus vandaag', fr: "Votre bus aujourd'hui" },
    body: { nl: 'Het dagoverzicht toont je haltes, passagiers en de status van je route.', fr: "L'aperçu du jour montre vos arrêts, vos passagers et l'état de votre itinéraire." },
    alt: { nl: 'BusApp dagoverzicht van de bus met haltes en passagiers.', fr: 'Aperçu quotidien BusApp du bus avec arrêts et passagers.' } },
  { src: '/media/guide/4335.jpg', width: 658, height: 1536,
    title: { nl: 'Route voorbereiden', fr: "Préparer l'itinéraire" },
    body: { nl: 'Laat BusApp een volgorde voorstellen of kies de volgorde zelf.', fr: "Laissez BusApp proposer un ordre ou choisissez-le vous-même." },
    alt: { nl: 'BusApp routescherm met automatische of zelfgekozen volgorde.', fr: "Écran d'itinéraire BusApp avec ordre automatique ou manuel." } },
  { src: '/media/guide/4337.jpg', width: 658, height: 1536,
    title: { nl: 'Passagiers en oudercodes', fr: 'Passagers et codes parents' },
    body: { nl: 'Koppel passagiers aan een halte en maak een veilige oudercode aan.', fr: 'Associez les passagers à un arrêt et créez un code parent sécurisé.' },
    alt: { nl: 'BusApp passagiersscherm met oudercodes.', fr: 'Écran des passagers BusApp avec les codes parents.' } },
  { src: '/media/guide/4339.jpg', width: 658, height: 1536,
    title: { nl: 'Jouw profiel en je bus', fr: 'Votre profil et votre bus' },
    body: { nl: 'Je persoonlijke profiel en het busprofiel blijven duidelijk gescheiden.', fr: 'Votre profil personnel et le profil du bus restent clairement séparés.' },
    alt: { nl: 'BusApp profielscherm met persoonlijke avatar en businstellingen.', fr: 'Écran de profil BusApp avec avatar personnel et réglages du bus.' } },
  { src: '/media/guide/4343.jpg', width: 658, height: 1536,
    title: { nl: 'Profiel aanpassen', fr: 'Modifier le profil' },
    body: { nl: 'Kies een BusApp-avatar of upload een eigen foto. Opslaan of annuleren is altijd duidelijk.', fr: "Choisissez un avatar BusApp ou importez une photo. Enregistrer ou annuler reste toujours clair." },
    alt: { nl: 'BusApp scherm om je persoonlijke profiel en avatar aan te passen.', fr: 'Écran BusApp pour modifier votre profil personnel et votre avatar.' } },
  { src: '/media/guide/4345.jpg', width: 658, height: 1536,
    title: { nl: 'Busprofiel aanpassen', fr: 'Modifier le profil du bus' },
    body: { nl: 'Geef je bus een naam en een herkenbare avatar of foto.', fr: 'Donnez à votre bus un nom et un avatar ou une photo reconnaissable.' },
    alt: { nl: 'BusApp scherm om het busprofiel en de busavatar aan te passen.', fr: "Écran BusApp pour modifier le profil et l'avatar du bus." } },
  { src: '/media/guide/4341.jpg', width: 658, height: 1536,
    title: { nl: 'Privacy in de app', fr: "La confidentialité dans l'application" },
    body: { nl: 'De belofte staat ook in de app zelf: volg de bus, niet de kinderen.', fr: "La promesse figure aussi dans l'application : suivez le bus, pas les enfants." },
    alt: { nl: 'BusApp profielscherm met de privacyboodschap volg de bus, niet de kinderen.', fr: 'Écran de profil BusApp avec le message de confidentialité suivez le bus, pas les enfants.' } },
];
