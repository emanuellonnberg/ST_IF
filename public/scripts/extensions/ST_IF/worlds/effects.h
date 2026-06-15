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

! --- giveable item pool ------------------------------------------------------
! A handful of blank, real Z-machine objects an NPC can hand to the player. Each
! gets a runtime name (stored as TEXT, like flags) and becomes a normal object
! you can examine, carry, drop, and give back. xgive claims one into your hands;
! xtakeitem removes a named one you hold and frees the slot.
Constant XE_ITEMS = 8;
Constant XE_INBUF = 20;            ! per-item name buffer (byte 0 = length)
Array XE_ItemName -> XE_ITEMS * XE_INBUF;

[ XE_INm i; return XE_ItemName + i * XE_INBUF; ];

Class XE_Item
  with parse_name [ ba bl wa wl i;
           ba = XE_INm(self.slot); bl = ba->0;
           if (bl == 0) return 0;                     ! unclaimed -> unmatchable
           wa = WordAddress(wn); wl = WordLength(wn);
           if (wl ~= bl) return 0;
           for (i=0 : i<wl : i++) if ((wa->i) ~= (ba->(i+1))) return 0;
           wn++; return 1;
       ],
       short_name [ ba bl i; ba = XE_INm(self.slot); bl = ba->0;
           for (i=0 : i<bl : i++) print (char) ba->(i+1); rtrue; ],
       description [; print "An ordinary "; print (name) self; ", given to you."; ],
       slot 0;

XE_Item xitem_0 with slot 0;
XE_Item xitem_1 with slot 1;
XE_Item xitem_2 with slot 2;
XE_Item xitem_3 with slot 3;
XE_Item xitem_4 with slot 4;
XE_Item xitem_5 with slot 5;
XE_Item xitem_6 with slot 6;
XE_Item xitem_7 with slot 7;

[ XE_ItemFree i;                  ! first unclaimed slot, or -1
   for (i=0 : i<XE_ITEMS : i++) if ((XE_INm(i)->0) == 0) return i;
   return -1;
];
[ XE_ItemObj s   o;               ! the pool object for a slot
   objectloop (o ofclass XE_Item) if (o.slot == s) return o;
   return 0;
];
[ XgiveSub s o;
   if (WordLength(2) == 0) "xgive bad";
   s = XE_ItemFree(); if (s < 0) "xgive full";
   XE_CopyWord(2, XE_INm(s), XE_INBUF);
   o = XE_ItemObj(s); if (o == 0) "xgive full";
   move o to player;
   "xgive ok";
];
[ XtakeitemSub o;
   if (WordLength(2) == 0) "xtakeitem bad";
   objectloop (o in player)
      if (o ofclass XE_Item && XE_WordEq(2, XE_INm(o.slot))) {
         remove o; (XE_INm(o.slot))->0 = 0;          ! free the slot
         "xtakeitem ok";
      }
   "xtakeitem none";
];

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
Verb 'xgive'     * topic -> Xgive;
Verb 'xtakeitem' * topic -> Xtakeitem;
