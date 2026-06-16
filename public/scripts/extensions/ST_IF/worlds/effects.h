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

! --- NPC body pool ----------------------------------------------------------
! Blank `animate` objects the engine materialises so the parser can act on a
! registry NPC physically: examine them, "give key to maeve", "show coin to tomas".
! Dialogue stays with the LLM/card; these are just the bodies. A body keeps its
! held items while off-stage (XE_Limbo), so a gift to an NPC persists.
Constant XE_NPCS = 8;
Constant XE_NNBUF = 24;            ! per-NPC name buffer (byte 0 = length)
Array XE_NpcName -> XE_NPCS * XE_NNBUF;

Object XE_Limbo "(off-stage)";    ! holder for absent NPCs' bodies + their belongings

[ XE_NNm i; return XE_NpcName + i * XE_NNBUF; ];

Class XE_Npc
  with parse_name [ ba bl wa wl i;
           ba = XE_NNm(self.slot); bl = ba->0;
           if (bl == 0) return 0;                     ! unclaimed -> unmatchable
           wa = WordAddress(wn); wl = WordLength(wn);
           if (wl ~= bl) return 0;
           for (i=0 : i<wl : i++) if ((wa->i) ~= (ba->(i+1))) return 0;
           wn++; return 1;
       ],
       short_name [ ba bl i c; ba = XE_NNm(self.slot); bl = ba->0;
           for (i=0 : i<bl : i++) { c = ba->(i+1); if (i == 0 && c >= 'a' && c <= 'z') c = c - 32; print (char) c; }
           rtrue; ],
       description "A figure in the scene.",
       life [;
           Give: move noun to self; print "You hand ", (the) noun, " to ", (the) self, "."; new_line; rtrue;
           default: rfalse;                            ! talk etc. is handled by the narrator/card
       ],
       slot 0
  has animate proper;

XE_Npc xnpc_0 with slot 0;
XE_Npc xnpc_1 with slot 1;
XE_Npc xnpc_2 with slot 2;
XE_Npc xnpc_3 with slot 3;
XE_Npc xnpc_4 with slot 4;
XE_Npc xnpc_5 with slot 5;
XE_Npc xnpc_6 with slot 6;
XE_Npc xnpc_7 with slot 7;

[ XE_NpcObj s   o; objectloop (o ofclass XE_Npc) if (o.slot == s) return o; return 0; ];
[ XE_NpcFree i; for (i=0 : i<XE_NPCS : i++) if ((XE_NNm(i)->0) == 0) return i; return -1; ];
[ XE_NpcFind wx   i; for (i=0 : i<XE_NPCS : i++) if ((XE_NNm(i)->0) ~= 0 && XE_WordEq(wx, XE_NNm(i))) return XE_NpcObj(i); return 0; ];

[ XnpcSub o s;       ! ensure NPC word(2) has a body, here in the player's room
   if (WordLength(2) == 0) "xnpc bad";
   o = XE_NpcFind(2);
   if (o == 0) { s = XE_NpcFree(); if (s < 0) "xnpc full"; XE_CopyWord(2, XE_NNm(s), XE_NNBUF); o = XE_NpcObj(s); }
   if (o == 0) "xnpc full";
   move o to location;
   "xnpc ok";
];
[ XnpcawaySub o;     ! send NPC word(2)'s body off-stage (keeps whatever it holds)
   if (WordLength(2) == 0) "xnpcaway bad";
   o = XE_NpcFind(2);
   if (o == 0) "xnpcaway none";
   move o to XE_Limbo;
   "xnpcaway ok";
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

! All engine verbs are `meta`: they change ground truth without advancing the
! world clock (no daemons/timers), so the per-turn NPC-body sync can't fast-forward
! a cooking timer or any other each_turn process.
Verb meta 'xflag'  * topic -> Xflag;
Verb meta 'xflagq' * topic -> Xflagq;
Verb meta 'xgrant' * topic -> Xgrant;
Verb meta 'xtake'  * topic -> Xtake;
Verb meta 'xgold'  * -> Xgold;
Verb meta 'xgive'     * topic -> Xgive;
Verb meta 'xtakeitem' * topic -> Xtakeitem;
Verb meta 'xnpc'      * topic -> Xnpc;
Verb meta 'xnpcaway'  * topic -> Xnpcaway;
