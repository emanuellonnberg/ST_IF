! effects.h — reusable NPC-effect surface for ST_IF worlds. CC0.
! Include AFTER VerbLib and BEFORE Grammar. Gives the engine validated verbs to
! change ground-truth state: set named flags (generic) and grant/take gold (the
! host maps its own meter via XE_AddGold / XE_Gold). The VM executes + clamps, so
! an LLM-voiced NPC's reward becomes real ground truth.

Constant XE_MAXFLAG = 32;
Constant XE_FNBUF = 24;           ! per-flag name buffer (byte 0 = length)
Array XE_FlagName -> XE_MAXFLAG * XE_FNBUF;   ! set flags, stored as TEXT (not dict words)
Global XE_nflag = 0;

! --- text helpers (flags are arbitrary names, so match by characters) ---
[ XE_FNm i; return XE_FlagName + i * XE_FNBUF; ];
[ XE_WordEq wx arr   ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx);
   if (ln ~= arr->0) rfalse;
   for (i=0 : i<ln : i++) if (ad->i ~= arr->(i+1)) rfalse; rtrue;
];
[ XE_CopyWord wx arr cap   ad ln i;
   ad = WordAddress(wx); ln = WordLength(wx); if (ln > cap-1) ln = cap-1;
   arr->0 = ln; for (i=0 : i<ln : i++) arr->(i+1) = ad->i;
];
[ XE_FindFlag wx   i;
   for (i=0 : i<XE_nflag : i++) if (XE_WordEq(wx, XE_FNm(i))) return i;
   return -1;
];
[ XE_NumOf wx   ad ln i n;       ! parse a non-negative integer from word wx
   ad = WordAddress(wx); ln = WordLength(wx); n = 0;
   for (i=0 : i<ln : i++) {
      if (ad->i < '0' || ad->i > '9') return n;
      n = n * 10 + (ad->i - '0');
   }
   return n;
];

! Host hooks for the gold meter (overridable). Default: no economy.
#Ifndef XE_AddGold; [ XE_AddGold n; n = n; ]; #Endif;
#Ifndef XE_Gold;    [ XE_Gold; return 0; ]; #Endif;

! --- meta-verbs the engine drives ---
[ XflagSub;
   if (WordLength(2) == 0) "xflag bad";
   if (XE_FindFlag(2) == -1 && XE_nflag < XE_MAXFLAG) { XE_CopyWord(2, XE_FNm(XE_nflag), XE_FNBUF); XE_nflag++; }
   "xflag ok";
];
[ XflagqSub;
   if (XE_FindFlag(2) >= 0) print "1"; else print "0";
   new_line; rtrue;
];
[ XgrantSub; XE_AddGold(XE_NumOf(2)); "xgrant ok"; ];
[ XtakeSub;  XE_AddGold(-XE_NumOf(2)); "xtake ok"; ];
[ XgoldSub;  print XE_Gold(); new_line; rtrue; ];

Verb 'xflag'  * topic -> Xflag;
Verb 'xflagq' * topic -> Xflagq;
Verb 'xgrant' * topic -> Xgrant;
Verb 'xtake'  * topic -> Xtake;
Verb 'xgold'  * -> Xgold;
