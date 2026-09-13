export interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  duration: string;
  seconds: number;
  thumb: string;
  isPremiere?: boolean;
  premiereText?: string;
  startTime?: number;
}

export const DEFAULT_PLAYLIST_ID = "PLkCaFs485nRqjo-8WlwgELRmZZP1dc5HS";

export const OFFICIAL_PLAYLIST: PlaylistItem[] = [
  {
    "id": "saa5rE45ezM",
    "title": "Ishq de Fanniyar - Female│Jyotica Tangri│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:15",
    "seconds": 315,
    "thumb": "https://i.ytimg.com/vi/saa5rE45ezM/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "ojqx-vOEJR0",
    "title": "TERE NAAM│UDIT NARAYAN│ALKA YAGNIK│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "7:00",
    "seconds": 420,
    "thumb": "https://i.ytimg.com/vi/ojqx-vOEJR0/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "_5aquKDMN5A",
    "title": "HAR KISI KO│Arijit Singh│NEETI MOHAN│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:58",
    "seconds": 358,
    "thumb": "https://i.ytimg.com/vi/_5aquKDMN5A/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "KeqMouF_d38",
    "title": "Mohabbat Ne Mohabbat Ko│Udit Narayan│Alka Yagnik│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:18",
    "seconds": 318,
    "thumb": "https://i.ytimg.com/vi/KeqMouF_d38/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "DBDOXlXqJSc",
    "title": "Sammi Meri Waar│Lashari_Waves│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "1:29",
    "seconds": 89,
    "thumb": "https://i.ytimg.com/vi/DBDOXlXqJSc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "eEvEWdrjNnY",
    "title": "SAWAN AAYA HAI│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:09",
    "seconds": 309,
    "thumb": "https://i.ytimg.com/vi/eEvEWdrjNnY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "pDjOa01cJZ8",
    "title": "HUM TUMKO NIGAHON MEIN│UDIT NARAYAN│SHREYA GHOSHAL│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:28",
    "seconds": 388,
    "thumb": "https://i.ytimg.com/vi/pDjOa01cJZ8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "6e3A3uy5-oE",
    "title": "Tose Naina Part 2│Twin Strings│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:04",
    "seconds": 244,
    "thumb": "https://i.ytimg.com/vi/6e3A3uy5-oE/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "u-7qtk4erLI",
    "title": "Sawaal│Abhijeet Srivastava│Siddhant Bhosle│Shayra Apoorva│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:48",
    "seconds": 228,
    "thumb": "https://i.ytimg.com/vi/u-7qtk4erLI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Rqj84MPskYg",
    "title": "Barsaat X Spider-Man (Brand New Day Edition)│Banjaare│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:36",
    "seconds": 216,
    "thumb": "https://i.ytimg.com/vi/Rqj84MPskYg/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "CGhj1PiFtik",
    "title": "Ae Watan│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:00",
    "seconds": 240,
    "thumb": "https://i.ytimg.com/vi/CGhj1PiFtik/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "-CKojNFWePw",
    "title": "Desh Mere│Arijit Singh│Arko│Manoj Muntashir│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:39",
    "seconds": 219,
    "thumb": "https://i.ytimg.com/vi/-CKojNFWePw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "t6Gui-sGGLo",
    "title": "Bandhu 2.0│Pritam│Kavita Seth│Neeraj Shridhar│Irshad Kamil│(Slowed + Reverb)By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:18",
    "seconds": 258,
    "thumb": "https://i.ytimg.com/vi/t6Gui-sGGLo/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "GfJwmqN8rjw",
    "title": "Barsaat│Banjaare│Roni│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:36",
    "seconds": 216,
    "thumb": "https://i.ytimg.com/vi/GfJwmqN8rjw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "S0fanhGd3cQ",
    "title": "KALYANI (Remix)│ARJN│KDS│FIFTY4│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:13",
    "seconds": 313,
    "thumb": "https://i.ytimg.com/vi/S0fanhGd3cQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "ZHNfNS79LEU",
    "title": "Baarish│Ash King│Shashaa Tirupati│Tanishk Bagchi│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:21",
    "seconds": 321,
    "thumb": "https://i.ytimg.com/vi/ZHNfNS79LEU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "ySDg2muCu5g",
    "title": "HANGOVER│Meet Bros Anjjan│Shreya Ghoshal│Salman Khan│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "7:15",
    "seconds": 435,
    "thumb": "https://i.ytimg.com/vi/ySDg2muCu5g/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "kyCZhqZCKo4",
    "title": "Halka Halka│Fanney Khan│Sunidhi Chauhan│Divya Kumar│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:47",
    "seconds": 287,
    "thumb": "https://i.ytimg.com/vi/kyCZhqZCKo4/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "JWW8LTBKvX4",
    "title": "Itna Na Mujhse Tu Pyar Barha (E V)│Lashari Waves│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:36",
    "seconds": 396,
    "thumb": "https://i.ytimg.com/vi/JWW8LTBKvX4/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "LfcM7UG7LGo",
    "title": "Tu Aashiqui Hai Meri│Payal Dev│Stebin Ben│Kunaal Vermaa│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:56",
    "seconds": 236,
    "thumb": "https://i.ytimg.com/vi/LfcM7UG7LGo/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "ngt6qNFd3Dw",
    "title": "Udd Jaa Kaale Kaava│Mithoon│Udit Narayan│Alka Yagnik│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:34",
    "seconds": 334,
    "thumb": "https://i.ytimg.com/vi/ngt6qNFd3Dw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "M_XdVD1fKZk",
    "title": "Teri Saanson Mein│Arijit Singh│Palak Muchhal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "7:02",
    "seconds": 422,
    "thumb": "https://i.ytimg.com/vi/M_XdVD1fKZk/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "6nW8lL3a1HM",
    "title": "Marjaana│B Praak│Siddhaant Miishhraa│Sameer Anjaan│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:09",
    "seconds": 369,
    "thumb": "https://i.ytimg.com/vi/6nW8lL3a1HM/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "h5yECiD4XOw",
    "title": "Guzaara│Josh Brar│Parampara Tandon│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:43",
    "seconds": 283,
    "thumb": "https://i.ytimg.com/vi/h5yECiD4XOw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "C0rr10to1WQ",
    "title": "Inaam│Jasleen Royal│Badshah│Ansh Chahal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:28",
    "seconds": 208,
    "thumb": "https://i.ytimg.com/vi/C0rr10to1WQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "F2v3VEHp86E",
    "title": "Sheesha│Swara Verma│Mitta Ror│Yeah Ishwar│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:48",
    "seconds": 228,
    "thumb": "https://i.ytimg.com/vi/F2v3VEHp86E/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "11u8LYPQj_U",
    "title": "Dooron Dooron│Paresh Pahuja│Shiv Tandan│Meghdeep Bose│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:11",
    "seconds": 251,
    "thumb": "https://i.ytimg.com/vi/11u8LYPQj_U/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "of4tzitGzuI",
    "title": "Teri Meri Kahaani│Arijit Singh│Palak Muchhal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:24",
    "seconds": 384,
    "thumb": "https://i.ytimg.com/vi/of4tzitGzuI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "eW74hcWkcMc",
    "title": "MANWA LAAGE│VISHAL-SHEKHAR│SHREYA GHOSHAL│ARIJIT SINGH│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:16",
    "seconds": 316,
    "thumb": "https://i.ytimg.com/vi/eW74hcWkcMc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Cik-CBXIbds",
    "title": "Udi Udi│Aneesh│Sarkar│Hruday│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:02",
    "seconds": 182,
    "thumb": "https://i.ytimg.com/vi/Cik-CBXIbds/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "yYkANg_nzus",
    "title": "Tera Yaar Hoon Main│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:07",
    "seconds": 307,
    "thumb": "https://i.ytimg.com/vi/yYkANg_nzus/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "F8IyE3lB4mY",
    "title": "Tum Kya Mile│Pritam│Arijit Singh│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:22",
    "seconds": 322,
    "thumb": "https://i.ytimg.com/vi/F8IyE3lB4mY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "4f0cM93wOIg",
    "title": "Ve Kamleya│Pritam│Arijit Singh│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:47",
    "seconds": 287,
    "thumb": "https://i.ytimg.com/vi/4f0cM93wOIg/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "LNTJwfqMZI0",
    "title": "Baarish Mein Phir│Saahel│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:26",
    "seconds": 206,
    "thumb": "https://i.ytimg.com/vi/LNTJwfqMZI0/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "QSDuk5lHijI",
    "title": "Bairan│Banjaare│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "2:56",
    "seconds": 176,
    "thumb": "https://i.ytimg.com/vi/QSDuk5lHijI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "uh_z6cfvqDk",
    "title": "Gehra Hua│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:59",
    "seconds": 419,
    "thumb": "https://i.ytimg.com/vi/uh_z6cfvqDk/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "fUWYADr1ims",
    "title": "Naach Meri Jaan│Pritam│Kamaal Khan│Nakash Aziz & Dev Negi│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:22",
    "seconds": 322,
    "thumb": "https://i.ytimg.com/vi/fUWYADr1ims/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "81qAr4g7Lvg",
    "title": "Main Agar│Pritam│Atif Aslam│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:24",
    "seconds": 324,
    "thumb": "https://i.ytimg.com/vi/81qAr4g7Lvg/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "mUfBpDoVrbc",
    "title": "Khat│Navjot Ahuja│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:32",
    "seconds": 332,
    "thumb": "https://i.ytimg.com/vi/mUfBpDoVrbc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "zX861h8JRI8",
    "title": "O Khuda│Amaal Mallik│Palak Muchhal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:44",
    "seconds": 344,
    "thumb": "https://i.ytimg.com/vi/zX861h8JRI8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "I8hdvhHlrqw",
    "title": "Sab Tera│Armaan Malik│Shraddha Kapoor│Amaal Malik│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:16",
    "seconds": 256,
    "thumb": "https://i.ytimg.com/vi/I8hdvhHlrqw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Q2EbDqptQys",
    "title": "Tu Hi Disda│Pritam│Arijit Singh│Nikhita Gandhi│Kumaar│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:11",
    "seconds": 311,
    "thumb": "https://i.ytimg.com/vi/Q2EbDqptQys/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "GLUC51EVYTk",
    "title": "Mahi Aaja (Unplugged)│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:15",
    "seconds": 255,
    "thumb": "https://i.ytimg.com/vi/GLUC51EVYTk/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "QpUCa02EnIk",
    "title": "Awara│Muskaan│Salman Ali│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:44",
    "seconds": 344,
    "thumb": "https://i.ytimg.com/vi/QpUCa02EnIk/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "kLqC9_LxAy0",
    "title": "Oh Sanam│Tony Kakkar│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:04",
    "seconds": 244,
    "thumb": "https://i.ytimg.com/vi/kLqC9_LxAy0/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Urtlx47w2XY",
    "title": "Udta Jaaye│Alok│Rashmeet Kaur│KR$NA│Garena Free Fire MAX│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:26",
    "seconds": 206,
    "thumb": "https://i.ytimg.com/vi/Urtlx47w2XY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "f8Kcieoe0zM",
    "title": "Sahiba│Jasleen Royal│Stebin Ben (Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:13",
    "seconds": 253,
    "thumb": "https://i.ytimg.com/vi/f8Kcieoe0zM/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "gzP_ojMFCmQ",
    "title": "Mera Dil Bhi Kitna Pagal Hai│Stebin Ben│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:54",
    "seconds": 234,
    "thumb": "https://i.ytimg.com/vi/gzP_ojMFCmQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "vTKEMER9kiU",
    "title": "Oh Humsafar│Neha Kakkar│Tony Kakkar│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:23",
    "seconds": 383,
    "thumb": "https://i.ytimg.com/vi/vTKEMER9kiU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "X11T1jOhDAA",
    "title": "Mansoob│Kaifi Khalil│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:11",
    "seconds": 191,
    "thumb": "https://i.ytimg.com/vi/X11T1jOhDAA/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "gFSlaYkfuIY",
    "title": "Kitab│Mr Dutt│Vipin Foji│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:32",
    "seconds": 212,
    "thumb": "https://i.ytimg.com/vi/gFSlaYkfuIY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Mwg5LDUHaSc",
    "title": "Toota Jo Kabhi Tara│Atif Aslam│Sumedha Karmahe│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:53",
    "seconds": 353,
    "thumb": "https://i.ytimg.com/vi/Mwg5LDUHaSc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "x8Y-NgZioCc",
    "title": "Khoobsurat│Kunaal Vermaa│Jubin Nautiyal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:58",
    "seconds": 298,
    "thumb": "https://i.ytimg.com/vi/x8Y-NgZioCc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "7cVIosSjAkQ",
    "title": "ISHQ MUBARAK│Arijit Singh│Ankit Tiwari│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:44",
    "seconds": 344,
    "thumb": "https://i.ytimg.com/vi/7cVIosSjAkQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "P_ocoe9JUpM",
    "title": "Suno- Na Sangemarmar│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:55",
    "seconds": 235,
    "thumb": "https://i.ytimg.com/vi/P_ocoe9JUpM/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "CCbELrSOuqM",
    "title": "Heeriye│Arijit Singh│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:24",
    "seconds": 384,
    "thumb": "https://i.ytimg.com/vi/CCbELrSOuqM/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "gfOZBwK56D8",
    "title": "Jo Tum Mere Ho│Anuv Jain│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:52",
    "seconds": 292,
    "thumb": "https://i.ytimg.com/vi/gfOZBwK56D8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "vc4DCNN_xRw",
    "title": "Zaalima│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:47",
    "seconds": 347,
    "thumb": "https://i.ytimg.com/vi/vc4DCNN_xRw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "OxY62_zpb_E",
    "title": "OODHNI│Udit Narayan│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "7:54",
    "seconds": 474,
    "thumb": "https://i.ytimg.com/vi/OxY62_zpb_E/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "bwBtM3Of6co",
    "title": "Dekhte Dekhte│Atif Aslam│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:58",
    "seconds": 298,
    "thumb": "https://i.ytimg.com/vi/bwBtM3Of6co/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "n2Onfs_35IE",
    "title": "KAUN TUJHE│Palak Muchhal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:40",
    "seconds": 280,
    "thumb": "https://i.ytimg.com/vi/n2Onfs_35IE/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "jVUdEj8OyNc",
    "title": "Janam Janam│Pritam│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "4:19",
    "seconds": 259,
    "thumb": "https://i.ytimg.com/vi/jVUdEj8OyNc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "kLg481Z_ils",
    "title": "RABBA│Mohit Chauhan│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:18",
    "seconds": 318,
    "thumb": "https://i.ytimg.com/vi/kLg481Z_ils/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "1WYLobgdKcw",
    "title": "Mann Jogiya│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:08",
    "seconds": 308,
    "thumb": "https://i.ytimg.com/vi/1WYLobgdKcw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "ModNSPkRaZY",
    "title": "Chal Wahan Jaate Hain│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:18",
    "seconds": 378,
    "thumb": "https://i.ytimg.com/vi/ModNSPkRaZY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "sAtL_fvmkzE",
    "title": "Raaz Aankhein Teri│Arijit Singh│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:38",
    "seconds": 338,
    "thumb": "https://i.ytimg.com/vi/sAtL_fvmkzE/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "wBrNMIgeVfo",
    "title": "Sunn Raha Hai Na Tu│Shreya Ghoshal│(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "6:05",
    "seconds": 365,
    "thumb": "https://i.ytimg.com/vi/wBrNMIgeVfo/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "jaqQbp0BxR0",
    "title": "Sun Saawariya｜Accha Insaan｜(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:02",
    "seconds": 182,
    "thumb": "https://i.ytimg.com/vi/jaqQbp0BxR0/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "z8ke-aXvi2A",
    "title": "Aarzu｜Noor, Khan｜Madhurxo｜(Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:38",
    "seconds": 218,
    "thumb": "https://i.ytimg.com/vi/z8ke-aXvi2A/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "g3LQrsoR52U",
    "title": "Arz Kiya Hai｜Coke Studio Bharat｜Anuv Jain (Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "5:34",
    "seconds": 334,
    "thumb": "https://i.ytimg.com/vi/g3LQrsoR52U/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "F_0mG_IuVnI",
    "title": "Majboor | Sheheryar Rehan × Zoha Waseem (Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "2:50",
    "seconds": 170,
    "thumb": "https://i.ytimg.com/vi/F_0mG_IuVnI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "F0B6HMOb5q8",
    "title": "The Last Letter - Maan Panu (Slowed + Reverb) By Beat Badge × Slowedfy",
    "artist": "Slowedfy",
    "duration": "3:16",
    "seconds": 196,
    "thumb": "https://i.ytimg.com/vi/F0B6HMOb5q8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "bd2YfPSZmbA",
    "title": "Abhi Mujh Mein Kahin (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "6:54",
    "seconds": 414,
    "thumb": "https://i.ytimg.com/vi/bd2YfPSZmbA/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "6PS0cGf2okY",
    "title": "I'm Done. Ft.Maan Panu (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:04",
    "seconds": 184,
    "thumb": "https://i.ytimg.com/vi/6PS0cGf2okY/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "AiOa944xajQ",
    "title": "Emptiness Drill - Arif Khan (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:51",
    "seconds": 231,
    "thumb": "https://i.ytimg.com/vi/AiOa944xajQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "RN1NJcqChU8",
    "title": "Tony Kakkar 90's Kid (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "2:36",
    "seconds": 156,
    "thumb": "https://i.ytimg.com/vi/RN1NJcqChU8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "DKjRwuGMgxQ",
    "title": "Oh Sanam (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:01",
    "seconds": 181,
    "thumb": "https://i.ytimg.com/vi/DKjRwuGMgxQ/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "DbrUruNWRao",
    "title": "Sooraj Dooba Hai (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:48",
    "seconds": 288,
    "thumb": "https://i.ytimg.com/vi/DbrUruNWRao/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "FADqxZQIQpU",
    "title": "Rasiya (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:49",
    "seconds": 289,
    "thumb": "https://i.ytimg.com/vi/FADqxZQIQpU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "SIQKofy1_hw",
    "title": "Daayre (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "5:23",
    "seconds": 323,
    "thumb": "https://i.ytimg.com/vi/SIQKofy1_hw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "fcmPhZxgUnA",
    "title": "Matt Jaao (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:39",
    "seconds": 279,
    "thumb": "https://i.ytimg.com/vi/fcmPhZxgUnA/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "opuoueY-Nk8",
    "title": "Koi Itna Khoobsurat Kaise Ho Sakta Hai (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:28",
    "seconds": 268,
    "thumb": "https://i.ytimg.com/vi/opuoueY-Nk8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "T1wU3RANPqI",
    "title": "Friends Forever Mashup (Memories + Mashup) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "5:49",
    "seconds": 349,
    "thumb": "https://i.ytimg.com/vi/T1wU3RANPqI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "viUC9_5qKro",
    "title": "Breakup Mashup 2021 (Memories + Mashup) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:55",
    "seconds": 235,
    "thumb": "https://i.ytimg.com/vi/viUC9_5qKro/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "IH1OlawmkLg",
    "title": "Tumhare Hi Rahenge Hum (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:16",
    "seconds": 256,
    "thumb": "https://i.ytimg.com/vi/IH1OlawmkLg/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "sUpzVOUhVSI",
    "title": "Sahiba (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:40",
    "seconds": 220,
    "thumb": "https://i.ytimg.com/vi/sUpzVOUhVSI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "3EZCScONDhI",
    "title": "Chal Diye Tum Kahan (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:50",
    "seconds": 290,
    "thumb": "https://i.ytimg.com/vi/3EZCScONDhI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "07s-UaJzTEI",
    "title": "Kya Meri Yaad Aati Hai (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:44",
    "seconds": 284,
    "thumb": "https://i.ytimg.com/vi/07s-UaJzTEI/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "b5rcu_9SsME",
    "title": "Na Door Hai Na Paas Hai (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:36",
    "seconds": 276,
    "thumb": "https://i.ytimg.com/vi/b5rcu_9SsME/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Os0iMoI_XA0",
    "title": "Heer (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:45",
    "seconds": 285,
    "thumb": "https://i.ytimg.com/vi/Os0iMoI_XA0/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Hy6PKofwISw",
    "title": "Duur Na Karin (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "2:59",
    "seconds": 179,
    "thumb": "https://i.ytimg.com/vi/Hy6PKofwISw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "_9lXVBh0_YU",
    "title": "Tera Mera Hai Pyaar Amar (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:43",
    "seconds": 223,
    "thumb": "https://i.ytimg.com/vi/_9lXVBh0_YU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "BONFy4t2NI8",
    "title": "Dil Diyan Gallan (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:56",
    "seconds": 296,
    "thumb": "https://i.ytimg.com/vi/BONFy4t2NI8/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "_Sr826w9dDU",
    "title": "Saiyaara Title Song (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "7:06",
    "seconds": 426,
    "thumb": "https://i.ytimg.com/vi/_Sr826w9dDU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Dv6Sg13Juno",
    "title": "Jhol - Maanu × Annural Khalid (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:46",
    "seconds": 286,
    "thumb": "https://i.ytimg.com/vi/Dv6Sg13Juno/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "jV3b97ZXzDA",
    "title": "Kalank (Bonus Track) (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "5:27",
    "seconds": 327,
    "thumb": "https://i.ytimg.com/vi/jV3b97ZXzDA/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "L4GXJURT1VU",
    "title": "Bhagwan Hai Kahan Re Tu (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "5:58",
    "seconds": 358,
    "thumb": "https://i.ytimg.com/vi/L4GXJURT1VU/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "UudCm021zXo",
    "title": "Bezubaan - Satyajeet Jena (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "7:04",
    "seconds": 424,
    "thumb": "https://i.ytimg.com/vi/UudCm021zXo/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "o9xZG48bYCA",
    "title": "Aftab - Tu Bata (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:04",
    "seconds": 184,
    "thumb": "https://i.ytimg.com/vi/o9xZG48bYCA/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "qPalKSJHIqc",
    "title": "Main Haara Nahi (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "4:17",
    "seconds": 257,
    "thumb": "https://i.ytimg.com/vi/qPalKSJHIqc/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "Ai7XopAWVqw",
    "title": "Industry World By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "2:39",
    "seconds": 159,
    "thumb": "https://i.ytimg.com/vi/Ai7XopAWVqw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "tdEz7dozQ0E",
    "title": "Aadami Ek Khilona Hai ft Arrjun pandey (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "1:41",
    "seconds": 101,
    "thumb": "https://i.ytimg.com/vi/tdEz7dozQ0E/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "0nCnmAztb9M",
    "title": "Koi Apna Hoga - Tony Kakkar (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "2:39",
    "seconds": 159,
    "thumb": "https://i.ytimg.com/vi/0nCnmAztb9M/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "A0B_IGQT5ps",
    "title": "Yuvi - Soo Jao (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:42",
    "seconds": 222,
    "thumb": "https://i.ytimg.com/vi/A0B_IGQT5ps/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "AUJBWskmPMw",
    "title": "Nai Lagda (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "5:31",
    "seconds": 331,
    "thumb": "https://i.ytimg.com/vi/AUJBWskmPMw/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "NFouINJpWNg",
    "title": "Finding Her (Slowed + Reverb) By Beat Badge × GW IMRAN",
    "artist": "GW IMRAN",
    "duration": "3:33",
    "seconds": 213,
    "thumb": "https://i.ytimg.com/vi/NFouINJpWNg/hqdefault.jpg",
    "isPremiere": false
  },
  {
    "id": "gZdv6TX6z1Y",
    "title": "YAARA │SLOWEDFY VIBES #1",
    "artist": "Slowedfy",
    "duration": "5:01",
    "seconds": 301,
    "thumb": "https://i.ytimg.com/vi/gZdv6TX6z1Y/hqdefault.jpg",
    "isPremiere": false
  }
];
