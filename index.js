const fs = require(`fs-extra`)
const zip = require(`extract-zip`)
const jomini = require(`jomini`)

const players = require(`./players`)
const euroProvinces = require(`./euroProvinces`)

const processScores = async () => {
  const saveZipFile = fs.readdirSync(`./`).filter(name => name.endsWith(`.eu4`)).find(() => true)

  if (!saveZipFile) throw new Error(`No zip file found. Please place save zip file in project root`)

  await zip(`./${saveZipFile}`, { dir: __dirname })

  const gamestateString = fs.readFileSync(`./gamestate`).toString(`utf8`)
  const metaString = fs.readFileSync(`./meta`).toString(`utf8`)

  const fixedGamestateString = gamestateString // what a set of bodges
    .split(`map_area_data{`).join(`map_area_data={`)
    .split(`
{
\t\t\t}`).join(``)
    .split(`
{STK\t\t\t}`).join(``)
    .split(`
{AKT\t\t\t}`).join(``)

  const { date: currentDate } = jomini.parse(metaString)
  const gamestateParsed = jomini.parse(fixedGamestateString)
  const { provinces, diplomacy } = gamestateParsed

  const playersNations = Object.entries(players).map(([playerTag, playerName]) => ({
    playerName: `${playerName} (${playerTag})`,
    nationTag: playerTag,
    subjectTags: diplomacy.dependency.filter(({ first, start_date, end_date }) => first === playerTag && (!start_date || start_date <= currentDate) && (!end_date || end_date > currentDate)).map(({ second }) => second)
  }))

  const euroProvinceData = Object.entries(provinces).filter(([ id ], i) => euroProvinces.includes(parseInt(id.split(`-`).join(``), 10))).map(([, province]) => province)
  const hreProvinces = Object.values(provinces).filter(({ hre }) => hre && !!hre)

  const scoreData = playersNations.map(({ playerName, nationTag, subjectTags }) => ({
    playerName,
    score: hreProvinces.filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + hreProvinces.filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0),
    euroDev: euroProvinceData.filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + euroProvinceData.filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0),
    totalDev: Object.values(provinces).filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + Object.values(provinces).filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0),
    debug: {
      owned: hreProvinces.filter(({owner}) => owner === nationTag).map(({ name,  base_tax, base_production, base_manpower}) => ({name, base_tax, base_production, base_manpower })),
      subjects: hreProvinces.filter(({owner}) => subjectTags.includes(owner)).map(({ name,  base_tax, base_production, base_manpower}) => ({name, base_tax, base_production, base_manpower }))
    }
  })).sort(({ score: scoreA }, { score: scoreB }) => scoreB >= scoreA ? 1 : -1)

  return scoreData.reduce((acc, { playerName, score, euroDev, totalDev, debug }) => ({
    ...acc,
    [playerName]: `${score} (${euroDev}/${totalDev})`
  }), {})
}

processScores()
  .then(console.log)
  .catch(console.log)