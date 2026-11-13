/** Published sources behind the scientific checks. Each entry states only what the source
 *  establishes; the checks quote these facts and set them beside what this analysis measured. */
export interface Reference {
  short: string
  full: string
  /** Publisher or agency page; books have none. */
  url?: string
}

export const REFERENCES = {
  schroeder2014: {
    short: 'Schroeder et al. 2014',
    full: 'Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product: algorithm description and initial assessment. Remote Sensing of Environment 143, 85–96.',
    url: 'https://doi.org/10.1016/j.rse.2013.12.008',
  },
  giglio2016: {
    short: 'Giglio et al. 2016',
    full: 'Giglio, L., Schroeder, W., Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. Remote Sensing of Environment 178, 31–41.',
    url: 'https://doi.org/10.1016/j.rse.2016.02.054',
  },
  modisGuide: {
    short: 'MODIS Fire User Guide',
    full: 'Giglio, L., Schroeder, W., Hall, J. V., Justice, C. O. MODIS Collection 6 and Collection 6.1 Active Fire Product User’s Guide. NASA.',
    url: 'https://earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf',
  },
  giglio2007: {
    short: 'Giglio 2007',
    full: 'Giglio, L. (2007). Characterization of the tropical diurnal fire cycle using VIRS and MODIS observations. Remote Sensing of Environment 108, 407–421.',
    url: 'https://doi.org/10.1016/j.rse.2006.11.018',
  },
  giglio2006: {
    short: 'Giglio et al. 2006',
    full: 'Giglio, L., Csiszar, I., Justice, C. O. (2006). Global distribution and seasonality of active fires as observed with the Terra and Aqua MODIS sensors. Journal of Geophysical Research 111, G02016.',
    url: 'https://doi.org/10.1029/2005JG000142',
  },
  wooster2005: {
    short: 'Wooster et al. 2005',
    full: 'Wooster, M. J., Roberts, G., Perry, G. L. W., Kaufman, Y. J. (2005). Retrieval of biomass combustion rates and totals from fire radiative power observations. Journal of Geophysical Research 110, D24311.',
    url: 'https://doi.org/10.1029/2005JD006318',
  },
  malamud1998: {
    short: 'Malamud et al. 1998',
    full: 'Malamud, B. D., Morein, G., Turcotte, D. L. (1998). Forest fires: an example of self-organized critical behavior. Science 281, 1840–1842.',
    url: 'https://doi.org/10.1126/science.281.5384.1840',
  },
  chergui2018: {
    short: 'Chergui et al. 2018',
    full: 'Chergui, B. et al. (2018). Socioeconomic factors drive fire-regime variability in the Mediterranean Basin. Ecosystems 21, 619–628.',
    url: 'https://www.uv.es/jgpausas/papers/Chergui-2018-Ecosystems_fires-Rif-Valencia.pdf',
  },
  copernicus2023: {
    short: 'Copernicus ESOTC 2023',
    full: 'Copernicus Climate Change Service (2024). European State of the Climate 2023: Wildfires.',
    url: 'https://climate.copernicus.eu/esotc/2023/wildfires',
  },
  aquaOrbit: {
    short: 'NASA Aqua status',
    full: 'NASA Aqua project. Aqua completed its last orbit-maintenance maneuvers in 2021 and has drifted freely since January 2022; its equator crossing passed the 13:45 science limit in February 2023.',
    url: 'https://aqua.nasa.gov/',
  },
  terraOrbit: {
    short: 'NASA Terra orbit',
    full: 'NASA Terra project. Last inclination-adjust maneuver in February 2020, after which the crossing time drifts earlier; constellation exit in October 2022.',
    url: 'https://terra.nasa.gov/about/terras-orbit-changes/terra-orbital-drift-information/a-message-from-the-project-scientist',
  },
  aquaPlan: {
    short: 'NASA LAADS notice',
    full: 'NASA LAADS DAAC. Aqua MODIS acquisition plan through August 2026.',
    url: 'https://ladsweb.modaps.eosdis.nasa.gov/alerts-and-issues/171807',
  },
  modisAbout: {
    short: 'NASA LAADS DAAC',
    full: 'NASA LAADS DAAC. Terra & Aqua Moderate Resolution Imaging Spectroradiometer (MODIS): the two instruments view the entire Earth’s surface every 1 to 2 days.',
    url: 'https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/modis/',
  },
  turco2017: {
    short: 'Turco et al. 2017',
    full: 'Turco, M., von Hardenberg, J., AghaKouchak, A., Llasat, M. C., Provenzale, A., Trigo, R. M. (2017). On the key role of droughts in the dynamics of summer fires in Mediterranean Europe. Scientific Reports 7, 81.',
    url: 'https://doi.org/10.1038/s41598-017-00116-9',
  },
  earl2015: {
    short: 'Earl et al. 2015',
    full: 'Earl, N., Simmonds, I., Tapper, N. (2015). Weekly cycles of global fires: associations with religion, wealth and culture, and insights into anthropogenic influences on global climate. Geophysical Research Letters 42.',
    url: 'https://doi.org/10.1002/2015GL066383',
  },
  korontzi2006: {
    short: 'Korontzi et al. 2006',
    full: 'Korontzi, S., McCarty, J., Loboda, T., Kumar, S., Justice, C. (2006). Global distribution of agricultural fires in croplands from 3 years of Moderate Resolution Imaging Spectroradiometer (MODIS) data. Global Biogeochemical Cycles 20, GB2021.',
    url: 'https://doi.org/10.1029/2005GB002529',
  },
  nasaPower: {
    short: 'NASA POWER',
    full: 'NASA Langley Research Center (LaRC) POWER Project, Prediction Of Worldwide Energy Resources: daily MERRA-2 meteorology (T2M_MAX, PRECTOTCORR), accessed through the POWER API.',
    url: 'https://power.larc.nasa.gov/',
  },
  gelaro2017: {
    short: 'Gelaro et al. 2017',
    full: 'Gelaro, R. et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). Journal of Climate 30, 5419–5454.',
    url: 'https://doi.org/10.1175/JCLI-D-16-0758.1',
  },
  mann1945: {
    short: 'Mann 1945',
    full: 'Mann, H. B. (1945). Nonparametric tests against trend. Econometrica 13, 245–259.',
    url: 'https://doi.org/10.2307/1907187',
  },
  kendall1975: {
    short: 'Kendall 1975',
    full: 'Kendall, M. G. (1975). Rank Correlation Methods, 4th ed. Charles Griffin, London.',
  },
  sen1968: {
    short: 'Sen 1968',
    full: 'Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall’s tau. Journal of the American Statistical Association 63, 1379–1389.',
    url: 'https://doi.org/10.1080/01621459.1968.10480934',
  },
  zar2010: {
    short: 'Zar 2010',
    full: 'Zar, J. H. (2010). Biostatistical Analysis, 5th ed., chapter 27: circular distributions and the Rayleigh test. Pearson.',
  },
} satisfies Record<string, Reference>

export type ReferenceId = keyof typeof REFERENCES

/** The analysis area lies in the Mediterranean basin (a coarse box around the sea and its rim). */
export const inMediterranean = (centroid: { lat: number; lon: number } | null) => !!centroid && centroid.lat >= 29 && centroid.lat <= 46 && centroid.lon >= -10 && centroid.lon <= 37
