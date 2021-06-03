import { SgidClient } from '@opengovsg/sgid-client'
import fs from 'fs'
import { mocked } from 'ts-jest/utils'

import {
  SgidCreateRedirectUrlError,
  SgidFetchAccessTokenError,
  SgidFetchUserInfoError,
  SgidInvalidJwtError,
  SgidInvalidStateError,
  SgidVerifyJwtError,
} from '../sgid.errors'
import { SgidService } from '../sgid.service'

import {
  MOCK_ACCESS_TOKEN,
  MOCK_AUTH_CODE,
  MOCK_DESTINATION,
  MOCK_JWT,
  MOCK_JWT_PAYLOAD,
  MOCK_NONCE,
  MOCK_OPTIONS,
  MOCK_REDIRECT_URL,
  MOCK_REMEMBER_ME,
  MOCK_STATE,
  MOCK_TOKEN_RESULT,
  MOCK_USER_INFO,
} from './sgid.test.constants'

jest.mock('@opengovsg/sgid-client')
const MockSgidClient = mocked(SgidClient, true)
jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as typeof fs),
  readFileSync: jest.fn().mockImplementation((v) => v),
}))

describe('sgid.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
  })
  describe('constructor', () => {
    it('should create an SgidClient correctly', () => {
      const { endpoint, clientId, clientSecret, privateKey, redirectUri } =
        MOCK_OPTIONS
      const sgidService = new SgidService(MOCK_OPTIONS)
      expect(sgidService).toBeInstanceOf(SgidService)
      expect(MockSgidClient).toHaveBeenCalledWith({
        endpoint,
        clientId,
        clientSecret,
        privateKey,
        redirectUri,
      })
    })
  })
  describe('createRedirectUrl', () => {
    it('should return a string if ok', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.authorizationUrl.mockReturnValue({
        url: MOCK_REDIRECT_URL,
        nonce: MOCK_NONCE,
      })
      const url = sgidService.createRedirectUrl(MOCK_STATE)
      expect(url._unsafeUnwrap()).toEqual(MOCK_REDIRECT_URL)
      expect(sgidClient.authorizationUrl).toHaveBeenCalledWith(MOCK_STATE)
    })
    it('should return error if not ok', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.authorizationUrl.mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        url: undefined,
        nonce: MOCK_NONCE,
      })
      const url = sgidService.createRedirectUrl(MOCK_STATE)
      expect(url._unsafeUnwrapErr()).toBeInstanceOf(SgidCreateRedirectUrlError)
      expect(sgidClient.authorizationUrl).toHaveBeenCalledWith(MOCK_STATE)
    })
  })
  describe('parseState', () => {
    const sgidService = new SgidService(MOCK_OPTIONS)
    it('should parse state', () => {
      const state = sgidService.parseState(MOCK_STATE)
      expect(state._unsafeUnwrap()).toStrictEqual({
        formId: MOCK_DESTINATION,
        rememberMe: MOCK_REMEMBER_ME,
      })
    })
    it('should error on invalid state', () => {
      const state = sgidService.parseState('')
      expect(state._unsafeUnwrapErr()).toBeInstanceOf(SgidInvalidStateError)
    })
  })
  describe('token', () => {
    it('should return the access token given the code', async () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.callback.mockResolvedValue(MOCK_TOKEN_RESULT)
      const result = await sgidService.token(MOCK_AUTH_CODE)
      expect(result._unsafeUnwrap()).toStrictEqual(MOCK_TOKEN_RESULT)
      expect(sgidClient.callback).toHaveBeenCalledWith(MOCK_AUTH_CODE)
    })
    it('should return error on error', async () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.callback.mockRejectedValue(new Error())
      const result = await sgidService.token(MOCK_AUTH_CODE)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(
        SgidFetchAccessTokenError,
      )
      expect(sgidClient.callback).toHaveBeenCalledWith(MOCK_AUTH_CODE)
    })
  })
  describe('userInfo', () => {
    it('should return the userinfo given the code', async () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.userinfo.mockResolvedValue({
        sub: MOCK_USER_INFO.sub,
        data: {
          ...MOCK_USER_INFO.data,
          'myinfo.name': 'not supposed to be here',
        },
      })
      const result = await sgidService.userInfo({
        accessToken: MOCK_ACCESS_TOKEN,
      })
      expect(result._unsafeUnwrap()).toStrictEqual(MOCK_USER_INFO)
      expect(sgidClient.userinfo).toHaveBeenCalledWith(MOCK_ACCESS_TOKEN)
    })
    it('should return error on error', async () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.userinfo.mockRejectedValue(new Error())
      const result = await sgidService.userInfo({
        accessToken: MOCK_ACCESS_TOKEN,
      })
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(SgidFetchUserInfoError)
      expect(sgidClient.userinfo).toHaveBeenCalledWith(MOCK_ACCESS_TOKEN)
    })
  })
  describe('createJWT', () => {
    it('should return a jwt with short shelf life', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.createJWT.mockReturnValue(MOCK_JWT)
      const result = sgidService.createJWT(MOCK_USER_INFO.data, false)
      expect(result._unsafeUnwrap()).toStrictEqual({
        jwt: MOCK_JWT,
        maxAge: MOCK_OPTIONS.cookieMaxAge,
      })
      expect(sgidClient.createJWT).toHaveBeenCalledWith(
        {
          userName: MOCK_USER_INFO.data['myinfo.nric_number'],
          rememberMe: false,
        },
        MOCK_OPTIONS.cookieMaxAge / 1000,
      )
    })

    it('should return a jwt with long shelf life', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.createJWT.mockReturnValue(MOCK_JWT)
      const result = sgidService.createJWT(MOCK_USER_INFO.data, true)
      expect(result._unsafeUnwrap()).toStrictEqual({
        jwt: MOCK_JWT,
        maxAge: MOCK_OPTIONS.cookieMaxAgePreserved,
      })
      expect(sgidClient.createJWT).toHaveBeenCalledWith(
        {
          userName: MOCK_USER_INFO.data['myinfo.nric_number'],
          rememberMe: true,
        },
        MOCK_OPTIONS.cookieMaxAgePreserved / 1000,
      )
    })
  })
  describe('extractJWTInfo', () => {
    it('should return an sgID JWT payload', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.verifyJWT.mockReturnValue(MOCK_JWT_PAYLOAD)
      const result = sgidService.extractJWTInfo(MOCK_JWT)
      expect(result._unsafeUnwrap()).toStrictEqual(MOCK_JWT_PAYLOAD)
      expect(sgidClient.verifyJWT).toHaveBeenCalledWith(
        MOCK_JWT,
        MOCK_OPTIONS.publicKey,
      )
    })

    it('should return SgidInvalidJwtError on malformed payload', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.verifyJWT.mockReturnValue({})
      const result = sgidService.extractJWTInfo(MOCK_JWT)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(SgidInvalidJwtError)
      expect(sgidClient.verifyJWT).toHaveBeenCalledWith(
        MOCK_JWT,
        MOCK_OPTIONS.publicKey,
      )
    })
    it('should return SgidVerifyJwtError on verify failure', () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const sgidClient = mocked(MockSgidClient.mock.instances[0], true)
      sgidClient.verifyJWT.mockImplementation(() => {
        throw new Error()
      })
      const result = sgidService.extractJWTInfo(MOCK_JWT)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(SgidVerifyJwtError)
      expect(sgidClient.verifyJWT).toHaveBeenCalledWith(
        MOCK_JWT,
        MOCK_OPTIONS.publicKey,
      )
    })
  })
  describe('getCookieSettings', () => {
    it('should return a domain object if domain is defined', async () => {
      const sgidService = new SgidService(MOCK_OPTIONS)
      const cookieSettings = sgidService.getCookieSettings()
      expect(cookieSettings).toStrictEqual({
        domain: MOCK_OPTIONS.cookieDomain,
        path: '/',
      })
    })
    it('should return an empty object if domain is not defined', async () => {
      const sgidService = new SgidService({ ...MOCK_OPTIONS, cookieDomain: '' })
      const cookieSettings = sgidService.getCookieSettings()
      expect(cookieSettings).toStrictEqual({})
    })
  })
})
