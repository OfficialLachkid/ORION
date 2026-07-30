import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSerebiiGen1Pokedex, parseSerebiiGen2Pokedex, parseSerebiiGen3Pokedex } from '../src/pokedex-source.mjs';

const SAMPLE_GEN1_HTML = `
<table class="dextable" align="center">
  <tr>
    <td align="center" class="fooinfo">#0001</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/bulbasaur"><img src="/scarletviolet/pokemon/new/small/001.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/bulbasaur">Bulbasaur</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/grass"><img src="/pokedex-bw/type/grass.gif" /></a> <a href="/pokemon/type/poison"><img src="/pokedex-bw/type/poison.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/overgrow.shtml">Overgrow</a> <br /><a href="/abilitydex/chlorophyll.shtml">Chlorophyll</a></td>
    <td align="center" class="fooinfo">45</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">45</td>
  </tr>
  <tr>
    <td align="center" class="fooinfo">#0029</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/nidoranf"><img src="/swordshield/pokemon/small/029.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/nidoranf">Nidoran&#9792;</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/poison"><img src="/pokedex-bw/type/poison.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/poisonpoint.shtml">Poison Point</a> <br /><a href="/abilitydex/rivalry.shtml">Rivalry</a> <br /><a href="/abilitydex/hustle.shtml">Hustle</a></td>
    <td align="center" class="fooinfo">55</td>
    <td align="center" class="fooinfo">47</td>
    <td align="center" class="fooinfo">52</td>
    <td align="center" class="fooinfo">40</td>
    <td align="center" class="fooinfo">40</td>
    <td align="center" class="fooinfo">41</td>
  </tr>
</table>
`;

const SAMPLE_GEN2_HTML = `
<table class="dextable" align="center">
  <tr>
    <td align="center" class="fooinfo">#0152</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/chikorita"><img src="/scarletviolet/pokemon/new/small/152.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/chikorita">Chikorita</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/grass"><img src="/pokedex-bw/type/grass.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/overgrow.shtml">Overgrow</a> <br /><a href="/abilitydex/leafguard.shtml">Leaf Guard</a></td>
    <td align="center" class="fooinfo">45</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">49</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">45</td>
  </tr>
  <tr>
    <td align="center" class="fooinfo">#0169</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/crobat"><img src="/scarletviolet/pokemon/new/small/169.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/crobat">Crobat</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/poison"><img src="/pokedex-bw/type/poison.gif" /></a> <a href="/pokemon/type/flying"><img src="/pokedex-bw/type/flying.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/innerfocus.shtml">Inner Focus</a> <br /><a href="/abilitydex/infiltrator.shtml">Infiltrator</a></td>
    <td align="center" class="fooinfo">85</td>
    <td align="center" class="fooinfo">90</td>
    <td align="center" class="fooinfo">80</td>
    <td align="center" class="fooinfo">70</td>
    <td align="center" class="fooinfo">80</td>
    <td align="center" class="fooinfo">130</td>
  </tr>
</table>
`;

const SAMPLE_GEN3_HTML = `
<table class="dextable" align="center">
  <tr>
    <td align="center" class="fooinfo">#0252</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/treecko"><img src="/scarletviolet/pokemon/new/small/252.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/treecko">Treecko</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/grass"><img src="/pokedex-bw/type/grass.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/overgrow.shtml">Overgrow</a> <br /><a href="/abilitydex/unburden.shtml">Unburden</a></td>
    <td align="center" class="fooinfo">40</td>
    <td align="center" class="fooinfo">45</td>
    <td align="center" class="fooinfo">35</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">55</td>
    <td align="center" class="fooinfo">70</td>
  </tr>
  <tr>
    <td align="center" class="fooinfo">#0254</td>
    <td align="center" class="fooinfo"><table class="pkmn"><tr><td><a href="/pokemon/sceptile"><img src="/scarletviolet/pokemon/new/small/254.png" loading="lazy" style="height:120px" /></a></td></tr></table></td>
    <td align="center" class="fooinfo"><a href="/pokemon/sceptile">Sceptile</a></td>
    <td align="center" class="fooinfo"><a href="/pokemon/type/grass"><img src="/pokedex-bw/type/grass.gif" /></a></td>
    <td align="center" class="fooinfo"><a href="/abilitydex/overgrow.shtml">Overgrow</a> <br /><a href="/abilitydex/unburden.shtml">Unburden</a></td>
    <td align="center" class="fooinfo">70</td>
    <td align="center" class="fooinfo">85</td>
    <td align="center" class="fooinfo">65</td>
    <td align="center" class="fooinfo">105</td>
    <td align="center" class="fooinfo">85</td>
    <td align="center" class="fooinfo">120</td>
  </tr>
</table>
`;

test('Serebii Gen 1 parser emits truth-only pokedex rows', () => {
  const rows = parseSerebiiGen1Pokedex(SAMPLE_GEN1_HTML);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].national_dex_number, 1);
  assert.equal(rows[0].sprite_source_url, 'https://www.serebii.net/scarletviolet/pokemon/new/small/001.png');
  assert.deepEqual(rows[0].types, ['grass', 'poison']);
  assert.equal(rows[0].metadata.type_icon_source_urls[0], 'https://www.serebii.net/pokedex-bw/type/grass.gif');
  assert.equal(rows[1].name, 'Nidoran♀');
  assert.deepEqual(rows[1].types, ['poison']);
  assert.equal(rows[1].metadata.typing_basis, 'current_canonical_types_from_serebii_gen1_page');
  assert.deepEqual(rows[1].metadata.abilities, ['Poison Point', 'Rivalry', 'Hustle']);
});

test('Serebii Gen 2 parser emits Johto rows with type icons', () => {
  const rows = parseSerebiiGen2Pokedex(SAMPLE_GEN2_HTML);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].generation, 2);
  assert.equal(rows[0].region, 'johto');
  assert.equal(rows[0].metadata.typing_basis, 'current_canonical_types_from_serebii_gen2_page');
  assert.equal(rows[0].sprite_source_url, 'https://www.serebii.net/scarletviolet/pokemon/new/small/152.png');
  assert.deepEqual(rows[1].types, ['poison', 'flying']);
  assert.deepEqual(rows[1].metadata.type_icon_source_urls, [
    'https://www.serebii.net/pokedex-bw/type/poison.gif',
    'https://www.serebii.net/pokedex-bw/type/flying.gif',
  ]);
});

test('Serebii Gen 3 parser emits Hoenn rows with type icons', () => {
  const rows = parseSerebiiGen3Pokedex(SAMPLE_GEN3_HTML);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].generation, 3);
  assert.equal(rows[0].region, 'hoenn');
  assert.equal(rows[0].metadata.typing_basis, 'current_canonical_types_from_serebii_gen3_page');
  assert.equal(rows[0].sprite_source_url, 'https://www.serebii.net/scarletviolet/pokemon/new/small/252.png');
  assert.deepEqual(rows[1].types, ['grass']);
  assert.deepEqual(rows[1].metadata.abilities, ['Overgrow', 'Unburden']);
});
