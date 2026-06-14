// Integration tests for the tavern hub world, driving the real ifvms VM via vm.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IFVM } from '../vm.js';

const story = new Uint8Array(readFileSync(new URL('../worlds/tavern.z5', import.meta.url)));
async function tavern() { const vm = new IFVM(); await vm.load(story); return vm; }

test('map: starts in the Common Room', async () => {
    const vm = await tavern();
    assert.equal(vm.getStatus().location, 'Common Room');
});

test('map: the four hub exits reach their rooms', async () => {
    const vm = await tavern();
    assert.match(vm.step('east'), /Taproom/);
    assert.match(vm.step('west'), /Common Room/);
    assert.match(vm.step('west'), /Gambling Den/);
    assert.match(vm.step('east'), /Common Room/);
    assert.match(vm.step('up'), /Upstairs Landing/);
    assert.match(vm.step('east'), /Guest Room/);
    assert.match(vm.step('west'), /Upstairs Landing/);
    assert.match(vm.step('down'), /Common Room/);
    assert.match(vm.step('out'), /Courtyard/);
    assert.match(vm.step('in'), /Common Room/);
});

test('map: taproom reaches kitchen and the cellar trapdoor', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom
    assert.match(vm.step('north'), /Kitchen/);
    assert.match(vm.step('down'), /Cellar|pitch dark/i);  // kitchen -> cellar (dark)
});

test('map: the cellar is dark without a light', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom
    assert.match(vm.step('down'), /pitch dark/i, 'cellar is unlit');
});

test('map: a lit lantern reveals the cellar', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom (lantern is here)
    vm.step('take lantern');
    vm.step('turn on lantern');
    assert.match(vm.step('down'), /cellar|kegs/i, 'lantern lights the cellar');
});

test('economy: you start with 20 gold', async () => {
    const vm = await tavern();
    assert.match(vm.step('count gold'), /20 gold/i);
});

test('economy: status reports gold, drink, hunger, rest and day', async () => {
    const vm = await tavern();
    const s = vm.step('status');
    assert.match(s, /Gold: 20/i);
    assert.match(s, /Sober/i);
    assert.match(s, /Hungry/i);
    assert.match(s, /Weary/i);
    assert.match(s, /Day 1/i);
});

test('drink: order an ale, pay 2 gold, drink it to get tipsy', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom (barkeep + tankard here)
    assert.match(vm.step('order ale'), /fills your tankard/i);
    assert.match(vm.step('count gold'), /18 gold/i);
    assert.match(vm.step('drink'), /drain the tankard/i);
    assert.match(vm.step('status'), /Tipsy/i);
});

test('drink: ordering away from the barkeep is refused', async () => {
    const vm = await tavern();
    assert.match(vm.step('order ale'), /no barkeep/i);  // still in the Common Room
});

test('drink: the barkeep cuts you off at roaring drunk', async () => {
    const vm = await tavern();
    vm.step('east');
    for (let i = 0; i < 3; i++) { vm.step('order ale'); vm.step('drink'); }
    assert.match(vm.step('status'), /Roaring drunk/i);
    assert.match(vm.step('order ale'), /had enough/i, 'cut off at drunk 3');
});

test('food: ladle stew for 3 gold and eat it to become fed', async () => {
    const vm = await tavern();
    vm.step('east'); vm.step('north');        // Common -> Taproom -> Kitchen
    vm.step('take bowl');
    assert.match(vm.step('ladle stew'), /ladle a steaming bowl/i);
    assert.match(vm.step('count gold'), /17 gold/i);
    assert.match(vm.step('eat stew'), /hearty stew/i);
    assert.match(vm.step('status'), /Well-fed/i);
});

test('food: eating an empty bowl is refused', async () => {
    const vm = await tavern();
    vm.step('east'); vm.step('north');
    vm.step('take bowl');
    assert.match(vm.step('eat stew'), /ladle some stew/i);
});

test('food: ladling needs a bowl in hand', async () => {
    const vm = await tavern();
    vm.step('east'); vm.step('north');        // Kitchen, but bowl not taken
    assert.match(vm.step('ladle stew'), /need a bowl/i);
});

test('gamble: one round moves gold by exactly the 5-gold wager', async () => {
    const vm = await tavern();
    vm.step('west');                          // Common -> Gambling Den
    const out = vm.step('play dice');
    assert.match(out, /win 5 gold|lose 5 gold/i, 'a clear win or loss');
    const m = vm.step('count gold').match(/have (\d+) gold/i);
    assert.ok(m, 'purse reports a number');
    const now = Number(m[1]);
    assert.ok(now === 25 || now === 15, `balance is start +/- wager (got ${now})`);
});

test('gamble: cards is also playable', async () => {
    const vm = await tavern();
    vm.step('west');
    assert.match(vm.step('play cards'), /win 5 gold|lose 5 gold/i);
});

test('gamble: a wager you cannot cover is refused', async () => {
    const vm = await tavern();
    vm.step('west');
    for (let i = 0; i < 40; i++) {
        const g = vm.step('count gold').match(/have (\d+) gold/i);
        if (g && Number(g[1]) < 5) {
            assert.match(vm.step('play dice'), /haven't the coin/i);
            return;
        }
        vm.step('play dice');
    }
    assert.match(vm.step('play dice'), /win 5 gold|lose 5 gold|haven't the coin/i);
});

test('rest: sleeping without renting is refused', async () => {
    const vm = await tavern();
    vm.step('up'); vm.step('east');           // Landing -> Guest Room
    assert.match(vm.step('sleep'), /not paid for a bed/i);
});

test('rest: rent from the barkeep for 5 gold, then sleep to reset and advance the day', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom (barkeep)
    vm.step('order ale'); vm.step('drink');   // get tipsy + hungry; -2 gold
    assert.match(vm.step('rent room'), /iron key/i);
    assert.match(vm.step('count gold'), /13 gold/i);   // 20 - 2 (ale) - 5 (room)
    vm.step('west'); vm.step('up'); vm.step('east');    // -> Guest Room
    assert.match(vm.step('sleep'), /wake rested/i);
    const s = vm.step('status');
    assert.match(s, /Rested/i);
    assert.match(s, /Sober/i, 'sleep clears drunkenness');
    assert.match(s, /Day 2/i, 'sleep advances the day');
});

test('rest: renting away from the barkeep is refused', async () => {
    const vm = await tavern();
    assert.match(vm.step('rent room'), /only rent a room from the barkeep/i);
});

test('rest: renting twice in one night is refused (already have a room)', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom (barkeep)
    vm.step('rent room');                     // first rent succeeds
    assert.match(vm.step('rent room'), /already got a room/i);
});

test('roster: the common-room cast is present with archetype hooks', async () => {
    const vm = await tavern();
    const look = vm.step('look');
    assert.match(look, /sellsword|fighter/i);
    assert.match(vm.step('examine sellsword'), /sword|mercenary|warrior|sellsword/i);
    assert.match(vm.step('examine mage'), /spell|mage|wizard|arcane/i);
    assert.match(vm.step('examine bard'), /lute|song|bard|minstrel/i);
});

test('roster: talking to an NPC never errors (parser-safe presence markers)', async () => {
    const vm = await tavern();
    assert.match(vm.step('ask sellsword about quest'), /steel|sale|coin/i);  // its life[] line
    assert.match(vm.step('ask rogue about job'), /doors|locks|secrets/i);
});

test('roster: the stablehand and horse are in the courtyard', async () => {
    const vm = await tavern();
    vm.step('out');                           // Courtyard
    const look = vm.step('look');
    assert.match(look, /stablehand|horse/i);
    assert.match(vm.step('examine horse'), /horse|stable|saddle/i);
});

test('quest: the board posts three contracts and accepting one is recorded', async () => {
    const vm = await tavern();
    const board = vm.step('read board');
    assert.match(board, /Cellar rats/i);
    assert.match(board, /Escort to Mistford/i);
    assert.match(board, /lost locket/i);
    assert.match(vm.step('accept rats'), /job is yours/i);
    assert.match(vm.step('read board'), /Taken: Cellar rats/i);
});

test('quest: full cellar-rats earn-path pays 10 gold', async () => {
    const vm = await tavern();
    vm.step('accept rats');                   // Common Room
    vm.step('east');                          // Taproom
    vm.step('take lantern'); vm.step('turn on lantern');
    vm.step('down');                          // Cellar (now lit)
    assert.match(vm.step('examine rat'), /rat/i, 'the rat is visible with light');
    assert.match(vm.step('kill rat'), /dispatch|sharp blow/i);
    vm.step('up');                            // back to Taproom (barkeep)
    assert.match(vm.step('claim reward'), /counts out 10 gold/i);
    assert.match(vm.step('count gold'), /30 gold/i);   // 20 + 10
});

test('quest: claiming with no bounty owed is refused', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom (barkeep), no rat killed
    assert.match(vm.step('claim reward'), /no bounty for you/i);
});

test('quest: the rat cannot be fought in the dark', async () => {
    const vm = await tavern();
    vm.step('east'); vm.step('down');         // Cellar, no light
    assert.doesNotMatch(vm.step('kill rat'), /dispatch|sharp blow/i, 'cannot hit what you cannot see');
});

test('escort: deliver the merchant to Mistford and claim 25 gold', async () => {
    const vm = await tavern();
    vm.step('accept escort');                 // Common Room; merchant starts trailing
    vm.step('out');                           // Courtyard
    vm.step('east');                          // King's Road
    vm.step('east');                          // Bandit Stretch (bandit blocks merchant)
    assert.match(vm.step('kill bandit'), /bandit/i);
    assert.match(vm.step('east'), /Mistford/i);   // arrive; merchant delivered same turn
    vm.step('west'); vm.step('west'); vm.step('west');  // back to Courtyard
    vm.step('in'); vm.step('east');           // Common Room -> Taproom (barkeep)
    assert.match(vm.step('claim reward'), /25 gold/i);
    assert.match(vm.step('count gold'), /45 gold/i);   // 20 + 25
});

test('escort: the merchant will not enter the bandit stretch while the bandit lives', async () => {
    const vm = await tavern();
    vm.step('accept escort');
    vm.step('out'); vm.step('east');          // King's Road (merchant trailing)
    vm.step('east');                          // Bandit Stretch; merchant should hang back
    assert.doesNotMatch(vm.step('look'), /merchant/i, 'merchant hangs back from the bandits');
});

test('locket: find it in the glade and claim 15 gold', async () => {
    const vm = await tavern();
    vm.step('out'); vm.step('east');          // King's Road
    vm.step('north'); vm.step('north');       // Forest Trail -> Mossy Glade
    assert.match(vm.step('search log'), /uncover|locket|rummage/i);
    assert.match(vm.step('take locket'), /Taken|locket/i);
    vm.step('south'); vm.step('south');       // Forest Trail -> King's Road
    vm.step('west');                          // Courtyard
    vm.step('in'); vm.step('east');           // Common Room -> Taproom
    assert.match(vm.step('claim reward'), /15 gold/i);
    assert.match(vm.step('count gold'), /35 gold/i);  // 20 + 15
});

test('quest: the board marks a completed contract', async () => {
    const vm = await tavern();
    vm.step('east'); vm.step('take lantern'); vm.step('turn on lantern');
    vm.step('down'); vm.step('kill rat'); vm.step('up');
    vm.step('claim reward');                   // rats done + claimed
    vm.step('west');                           // Common Room (board)
    assert.match(vm.step('read board'), /Cellar rats.*done/is);
});

test('walkthrough: a full loop touches every sim and balances the books', async () => {
    const vm = await tavern();
    vm.step('accept rats');                   // Common Room
    vm.step('east');                          // Taproom
    vm.step('order ale'); vm.step('drink');   // -2 => 18, Tipsy
    vm.step('north');                         // Kitchen
    vm.step('take bowl'); vm.step('ladle stew');  // -3 => 15
    vm.step('eat stew');                      // Well-fed
    vm.step('south');                         // Taproom
    vm.step('take lantern'); vm.step('turn on lantern');
    vm.step('down');                          // Cellar
    vm.step('kill rat');
    vm.step('up');                            // Taproom (barkeep)
    vm.step('claim reward');                  // +10 => 25
    vm.step('rent room');                     // -5 => 20
    vm.step('west'); vm.step('up'); vm.step('east');  // Guest Room
    vm.step('sleep');                         // Day 2, Sober, Hungry, Rested
    const s = vm.step('status');
    assert.match(s, /Gold: 20/i, 'books balance: 20 -2 -3 +10 -5 = 20');
    assert.match(s, /Day 2/i);
    assert.match(s, /Rested/i);
    assert.match(s, /Sober/i);
    assert.match(s, /Hungry/i);
});

test('bard: request a tune and hear it played each turn', async () => {
    const vm = await tavern();
    assert.match(vm.step('request song'), /strikes up/i);
    assert.match(vm.step('wait'), /bard plays/i);
});

test('bard: requesting away from the bard is refused', async () => {
    const vm = await tavern();
    vm.step('east');                          // Taproom; bard is in the Common Room
    assert.match(vm.step('request song'), /isn't here/i);
});

test('bard: tip the bard for a rumor, paying 1 gold', async () => {
    const vm = await tavern();
    assert.match(vm.step('tip bard'), /bandits|Mistford/i);   // first rumor in the cycle
    assert.match(vm.step('count gold'), /19 gold/i);
});

test('bard: tips cycle through different rumors', async () => {
    const vm = await tavern();
    const r1 = vm.step('tip bard');
    const r2 = vm.step('tip bard');
    assert.notEqual(r1, r2, 'second tip gives a different rumor');
    assert.match(r2, /locket|woods/i);       // second rumor in the cycle
});
