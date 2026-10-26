import { VersionGraph } from '@start9labs/start-sdk'
import { v0_1_0_0 } from './v0_1_0_0'
import { v0_1_0_1 } from './v0_1_0_1'
import { v0_1_0_2 } from './v0_1_0_2'
import { v0_1_0_3 } from './v0_1_0_3'
import { v0_1_0_4 } from './v0_1_0_4'
import { v0_1_0_5 } from './v0_1_0_5'
import { v0_2_0_0 } from './v0_2_0_0'
import { v0_2_1_0 } from './v0_2_1_0'
import { v0_2_2_0 } from './v0_2_2_0'
import { v0_2_2_1 } from './v0_2_2_1'
import { v0_2_3_0 } from './v0_2_3_0'
import { v0_2_3_1 } from './v0_2_3_1'
import { v0_2_4_0 } from './v0_2_4_0'
import { v0_2_5_0 } from './v0_2_5_0'
import { v0_2_6_0 } from './v0_2_6_0'
import { v0_3_0_0 } from './v0_3_0_0'
import { v0_4_0_0 } from './v0_4_0_0'
import { v0_5_0_0 } from './v0_5_0_0'
import { v0_6_0_0 } from './v0_6_0_0'
import { v0_6_0_1 } from './v0_6_0_1'
import { v0_6_1_0 } from './v0_6_1_0'
import { v0_6_1_1 } from './v0_6_1_1'
import { v1_0_0_0 } from './v1_0_0_0'
import { v1_1_0_0 } from './v1_1_0_0'
import { v1_2_0_0 } from './v1_2_0_0'

export const versionGraph = VersionGraph.of({
  current: v1_2_0_0,
  other: [
    v1_1_0_0,
    v1_0_0_0,
    v0_6_1_1,
    v0_6_1_0,
    v0_6_0_1,
    v0_6_0_0,
    v0_5_0_0,
    v0_4_0_0,
    v0_3_0_0,
    v0_2_6_0,
    v0_2_5_0,
    v0_2_4_0,
    v0_2_3_1,
    v0_2_3_0,
    v0_2_2_1,
    v0_2_2_0,
    v0_2_1_0,
    v0_2_0_0,
    v0_1_0_5,
    v0_1_0_4,
    v0_1_0_3,
    v0_1_0_2,
    v0_1_0_1,
    v0_1_0_0,
  ],
})
