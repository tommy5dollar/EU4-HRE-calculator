const fs = require(`fs-extra`)
const zip = require(`extract-zip`)
const jomini = require(`jomini`)

const players = require(`./players`)

const processScores = async () => {
  const saveZipFile = fs.readdirSync(`./`).filter(name => name.endsWith(`.zip`)).find(() => true)

  if (!saveZipFile) throw new Error(`No zip file found. Please place save zip file in project root`)

  await zip(`./${saveZipFile}`, { dir: __dirname })

  const gamestateString = fs.readFileSync(`./gamestate`).toString(`utf8`)
  const metaString = fs.readFileSync(`./meta`).toString(`utf8`)

  const fixedGamestateString = gamestateString.split(`map_area_data{`).join(`map_area_data={`) // what a bodge

  const { provinces, diplomacy } = jomini.parse(fixedGamestateString)
  const { date: currentDate } = jomini.parse(metaString)

  const playersNations = Object.entries(players).map(([playerTag, playerName]) => ({
    playerName,
    nationTag: playerTag,
    subjectTags: diplomacy.dependency.filter(({ first, start_date, end_date }) => first === playerTag && (!start_date || start_date <= currentDate) && (!end_date || end_date > currentDate)).map(({ second }) => second)
  }))

  const hreProvinces = Object.values(provinces).filter(({ hre }) => !!hre)

  const scoreData = playersNations.map(({ playerName, nationTag, subjectTags }) => ({
    playerName,
    score: hreProvinces.filter(({owner}) => owner === nationTag).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0)
      + (hreProvinces.filter(({owner}) => subjectTags.includes(owner)).reduce((acc2, {base_tax, base_production, base_manpower}) => acc2 + base_tax + base_production + base_manpower, 0) / 2),
    debug: {
      owned: hreProvinces.filter(({owner}) => owner === nationTag).map(({ name,  base_tax, base_production, base_manpower}) => ({name, base_tax, base_production, base_manpower })),
      subjects: hreProvinces.filter(({owner}) => subjectTags.includes(owner)).map(({ name,  base_tax, base_production, base_manpower}) => ({name, base_tax, base_production, base_manpower }))
    }
  })).sort(({ score: scoreA }, { score: scoreB }) => scoreB >= scoreA ? 1 : -1)

  return scoreData.reduce((acc, { playerName, score, debug }) => ({
    ...acc,
    [playerName]: score
  }), {})
}

processScores()
  .then(console.log)
  .catch(console.log)