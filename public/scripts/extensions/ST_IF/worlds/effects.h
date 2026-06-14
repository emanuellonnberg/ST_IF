! effects.h — reusable NPC-effect surface for ST_IF worlds. CC0.
! Include AFTER VerbLib and BEFORE Grammar. Gives the engine validated verbs to
! change ground-truth state: set named flags (generic) and grant/take gold (the
! host maps its own meter via XE_AddGold / XE_Gold). The VM executes + clamps, so
! an LLM-voiced NPC's reward becomes real ground truth.

Constant XE_MAXFLAG = 32;
Array XE_Flag --> XE_MAXFLAG;     ! set flags, stored as dictionary words
Global XE_nflag = 0;

! --- word helpers (same idiom as expanse.h) ---
[ XE_DictOf wx; wn = wx; return NextWordStopped(); ];
[ XE_HasFlag dv i;
   for (i=0 : i<XE_nflag : i++) if (XE_Flag-->i == dv) rtrue;
   rfalse;
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
[ XflagSub  dv;
   dv = XE_DictOf(2);
   if (dv == 0 || dv == -1) "xflag bad";
   if (XE_HasFlag(dv) == false && XE_nflag < XE_MAXFLAG) { XE_Flag-->XE_nflag = dv; XE_nflag++; }
   "xflag ok";
];
[ XflagqSub  dv;
   dv = XE_DictOf(2);
   if (dv ~= 0 && dv ~= -1 && XE_HasFlag(dv)) print "1"; else print "0";
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
