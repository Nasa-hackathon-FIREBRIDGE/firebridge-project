/**
 * 1° global land mask for the decorative overpass globe.
 *
 * Rasterised from Natural Earth 1:110m admin-0 countries (public domain): 360 × 180 cells, row 0 is
 * 90°N–89°N and column 0 is 180°W–179°W. Each row is run-length encoded as alternating water/land runs
 * (water first); a run is one character of RUN_ALPHABET, or '.' followed by two characters for runs ≥ 63.
 * Illustration only — never used for any analysis.
 */
const RUN_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_'
const LAND_RLE =
  '.5E,.5E,.5E,.5E,.5E,.5E,.1G3si.3d,.1sq52422p.3a,.1m12p2P.1I1.1k,.1js1Rx8l3G7.1h,.1b18o5Muf.13721.1d,.1416513261b3Rw812.1a215.1b,Y432na6Rx433.1e3.1b,W5133264161c7PA1I8tf.13,.0_b44221dkE.1c9opn813v,U644e22boB.1b5qps13141v,Ta824325231314lz.1a4oC45d2B,Sh1335133914lw.1b4d4431Maav,02l1v42e53133igy.1a4b51U3js1,iftg553kexHan3a61.1mj1,ho3h2f3314553bc31rGhp52.1B291,02bR14137217254aeqHn52531d141.1G,05a.1k4229alLr322p1.1G,09521.1g9c8kb152ss111.28,183.1h117a23afeaqa3a5.2c,527.1e154ddbi8pb3b2.2e1,926.18522197dbk3qc2.2t1,f.19824443h7Md3.2u1,e.18g6m7Mc4.2d2a6,dj1Rg9n3Md4.25799,i8229Kh932.15d631.1_5311f,i125gJffW293266.1Si4h,m213iFgfU4e5421.1Qg7h,k3oJbfU4a3145.1Ri7h,h4rN5iT3a2137.1Qi7i,f2wN2nM31583113.1Vi7i,L12M3nK4245.2811d4k,PL3nK4163.2bd2m,Q.18K1462.2a11d2m,Q.1512O61.2c12A,RY111244Q.2e22A,T11S1366M.2h21B,TY66N.2f31B,UY3161PD1c3.1l41B,U.10Ww331b4.1lH,UV13Ze3e41493.1m52B,US41Ug342cc83.1k64z,TS-c61143ad74.1f94A,TS-c943a35485.1ca1D,TQ.10a7244152o3.1417b2C,UO.1198261333n4.122223c2C,UN.11af1532n5.1073b2D,VL.138a123633n4.144393D,WK.1643ab15.1u4465D,XJ.16he1a.1k6348D,XI.16ip.1k6238F,-D.17jo.1m96I,.0_B.17o53c.1m92M,.0_A.17q47313.1o81N,.1012w.17.24W,.1021n63.17W2.18W,.1121gd2.15Y3.17W,.1131ee3.13L1e3.15X,.1312df211.10M2e412.0_Y,.1412cf2.11O2f312ZZ,.1413a.1jO2f23aQ12W,.15139.1iQ2l9N31X,.1a8d7ZR3l9K51X,.1a97373YS2kaj4k.14,.1a96494VS2kdf5f.19,o1O954e3RS4hed8d32.15,.1c916a13521OS3ggbac31b1W,.1ee.17U3diabdd2W,.1gc.17U4ak9cec2W,.1j12a.13V2am6hcb2W,.1na.12W27o6ibb3V,.1q7.12X14r6ibc3U,.1s5.12Y11u5i218f1T,.1t3a5RX62o5i236d121S,.1u37a1211K.12p4i154e2U,.1v232241aL.11p311h162f121S,.1w41jL.0_r121h2n3S,.1z12jK.0_t3h2l5R,.1CkLYv2i2e262S,.1CpHa5IL133c4Z,.1CqH2cHM224a4-,.1CrYCO22395-,.1BsYBP31377-,.1BtXAS55992P,.1AuXzT4692522P,.1zw11UyV459112183K,.1zASxW5572393K,.1zDPwY54723a225D,.1zGNu-46112311141122cA,.1zIMs.103d211cb51s,.1zKLr.112d121f824s,.1zKLr.12421m13a71o,.1AJMq.147oaw,.1BIMq.184221232b11332w,.1BIMr.1f141m2b1j,.1CGNr.1I3t,.1CFOs.1r191B,.1DDPs81.1g742B,.1DCPt72.1g653A,.1EBPt63.1b31754z,.1FAPs64.1ac54z,.1GzOt46.1ae35x1,.1IxOr66.18ov12,.1JwPp75.19oy,.1KuRm95.18rw,.1KuRm95.14wf1f,.1KtTl85.13yg2d,.1JtUm75.12Bt,.1JrWm75.11Ct,.1JoZl93.12Ds,.1Jn.0_ic1.14Dr,.1Jn.0_i.1gEr,.1Jn.0_i.1hDr,.1Jm.11g.1iEq,.1Im.13e.1kCr,.1Im.13e.1kCr,.1Il.15c.1lCr,.1Ik.16b.1mc7is,.1Ij.179.1o9b21dt,.1Ii.192.1u4g11et,.1Hg.33dm16,.1Hg.35ao15,.1Gh.35ao24,.1Gg.37312r42,.1Gc.3I33,.1Gc.3J23,.1G9.3i3o2114,.1Ga.3h3n36,.1H8.3j1m47,.1Fa.3E49,.1F8.3G49,.1F8.3G3a,.1F9.3S,.1E9.3T,.1E8.291.1K,.1F6.3V,.1F683.3K,.1F6.3V,.1G6.3U,.1H7.3S,.1K2.3U,.5E,.5E,.5E,.5E,.5E,.5E,.5E,.1V2.3J,.1T2.3L,.1P3.351I,.1N4.1O6v1c4575e53A,.1M3.1Lf23f.11y,.1M3.1z17r9.1a21p,.1I9.1uD4.1ll,.1Ia.13.104.1ud,.1e1qeO.1g2.1A9,.1d6n11317L.2V9,R142hl143dJ.2Wa,Gs9DK.2Td,y.1hJ.2Ug,w.1eF.31g,m.1kF.35g,h33.1gr68.3ae,i36.1cq87.35j,w.1d5669c.32j,o.1td44.3ci,r.1u3.3tf,q.53b,0ff.5a,0.5E,0.5E,0.5E,0.5E,0.5E'

let decoded: Uint8Array | undefined

function landGrid() {
  if (decoded) return decoded
  const grid = new Uint8Array(360 * 180)
  LAND_RLE.split(',').forEach((row, i) => {
    let column = 0
    let land = false
    for (let k = 0; k < row.length;) {
      let run: number
      if (row[k] === '.') {
        run = RUN_ALPHABET.indexOf(row[k + 1]) * 64 + RUN_ALPHABET.indexOf(row[k + 2])
        k += 3
      } else {
        run = RUN_ALPHABET.indexOf(row[k])
        k += 1
      }
      if (land) grid.fill(1, i * 360 + column, i * 360 + column + run)
      column += run
      land = !land
    }
  })
  decoded = grid
  return grid
}

export function isLand(lat: number, lon: number) {
  const row = Math.min(179, Math.max(0, Math.floor(90 - lat)))
  const column = ((Math.floor(lon + 180) % 360) + 360) % 360
  return landGrid()[row * 360 + column] === 1
}
