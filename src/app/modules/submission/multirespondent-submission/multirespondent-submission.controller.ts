import { StatusCodes } from 'http-status-codes'
import mongoose from 'mongoose'
import { errAsync } from 'neverthrow'

import {
  ErrorDto,
  FormAuthType,
  FormWorkflowSettings,
  MultirespondentSubmissionDto,
  SubmissionType,
} from '../../../../../shared/types'
import { getMultirespondentSubmissionEditPath } from '../../../../../shared/utils/urls'
import { Environment } from '../../../../../src/types'
import config from '../../../config/config'
import { createLoggerWithLabel } from '../../../config/logger'
import { getMultirespondentSubmissionModel } from '../../../models/submission.server.model'
import * as CaptchaMiddleware from '../../../services/captcha/captcha.middleware'
import MailService from '../../../services/mail/mail.service'
import * as TurnstileMiddleware from '../../../services/turnstile/turnstile.middleware'
import { Pipeline } from '../../../utils/pipeline-middleware'
import { createReqMeta } from '../../../utils/request'
import { MalformedParametersError } from '../../core/core.errors'
import { ControllerHandler } from '../../core/core.types'
import { setFormTags } from '../../datadog/datadog.utils'
import { assertFormAvailable } from '../../form/admin-form/admin-form.utils'
import * as FormService from '../../form/form.service'
import {
  ensureFormWithinSubmissionLimits,
  ensurePublicForm,
  ensureValidCaptcha,
} from '../encrypt-submission/encrypt-submission.ensures'
import * as ReceiverMiddleware from '../receiver/receiver.middleware'
import {
  InvalidSubmissionTypeError,
  SubmissionFailedError,
} from '../submission.errors'
import {
  getEncryptedSubmissionData,
  transformAttachmentMetasToSignedUrls,
  uploadAttachments,
} from '../submission.service'
import { mapRouteError } from '../submission.utils'
import { reportSubmissionResponseTime } from '../submissions.statsd-client'

import * as MultirespondentSubmissionMiddleware from './multirespondent-submission.middleware'
import { checkFormIsMultirespondent } from './multirespondent-submission.service'
import {
  SubmitMultirespondentFormHandlerRequest,
  SubmitMultirespondentFormHandlerType,
  UpdateMultirespondentSubmissionHandlerRequest,
  UpdateMultirespondentSubmissionHandlerType,
} from './multirespondent-submission.types'
import { createMultirespondentSubmissionDto } from './multirespondent-submission.utils'

const logger = createLoggerWithLabel(module)
const MultirespondentSubmission = getMultirespondentSubmissionModel(mongoose)
const appUrl =
  process.env.NODE_ENV === Environment.Dev
    ? config.app.feAppUrl
    : config.app.appUrl

const submitMultirespondentForm = async (
  req: SubmitMultirespondentFormHandlerRequest,
  res: Parameters<SubmitMultirespondentFormHandlerType>[1],
) => {
  const { formId } = req.params

  const logMeta = {
    action: 'submitMultirespondentForm',
    ...createReqMeta(req),
    formId,
  }

  const form = req.formsg.formDef

  setFormTags(form)

  const ensurePipeline = new Pipeline(
    ensurePublicForm,
    ensureValidCaptcha,
    ensureFormWithinSubmissionLimits,
  )

  const hasEnsuredAll = await ensurePipeline.execute({
    form,
    logMeta,
    req,
    res,
  })

  if (!hasEnsuredAll) {
    if (!res.headersSent) {
      const { errorMessage, statusCode } = mapRouteError(
        new SubmissionFailedError(),
      )
      return res.status(statusCode).json({ message: errorMessage })
    }
    return // required to stop submission processing
  }

  // Disallow form authentication for multirespondent forms
  if (form.authType !== FormAuthType.NIL) {
    logger.error({
      message: 'Multirespondent form is not allowed to have authorization',
      meta: logMeta,
    })
    const { errorMessage, statusCode } = mapRouteError(
      new MalformedParametersError(
        'Multirespondent form is not allowed to have authType',
      ),
    )
    return res.status(statusCode).json({ message: errorMessage })
  }

  // Save Responses to Database
  const encryptedPayload = req.formsg.encryptedPayload
  let attachmentMetadata = new Map<string, string>()

  if (encryptedPayload.attachments) {
    const attachmentUploadResult = await uploadAttachments(
      form._id,
      encryptedPayload.attachments,
    )

    if (attachmentUploadResult.isErr()) {
      const { statusCode, errorMessage } = mapRouteError(
        attachmentUploadResult.error,
      )
      return res.status(statusCode).json({
        message: errorMessage,
      })
    } else {
      attachmentMetadata = attachmentUploadResult.value
    }
  }

  // Create Incoming Submission
  const {
    submissionPublicKey,
    encryptedSubmissionSecretKey,
    submissionSecretKey,
    encryptedContent,
    responseMetadata,
    version,
  } = encryptedPayload

  const submissionContent = {
    form: form._id,
    authType: form.authType,
    myInfoFields: form.getUniqueMyInfoAttrs(),
    form_fields: form.form_fields,
    form_logics: form.form_logics,
    submissionPublicKey,
    encryptedSubmissionSecretKey,
    encryptedContent,
    attachmentMetadata,
    version,
    workflowStep: 0,
  }

  return _createSubmission({
    req,
    res,
    logMeta,
    formId,
    // responses: ,
    responseMetadata,
    submissionContent,
    submissionSecretKey,
    form,
  })
}

const _createSubmission = async ({
  req,
  res,
  logMeta,
  formId,
  // responses,
  responseMetadata,
  submissionContent,
  submissionSecretKey,
  form,
}: {
  req: Parameters<SubmitMultirespondentFormHandlerType>[0]
  res: Parameters<SubmitMultirespondentFormHandlerType>[1]
  [others: string]: any
}) => {
  const submission = new MultirespondentSubmission(submissionContent)

  try {
    await submission.save()
  } catch (err) {
    logger.error({
      message: 'Multirespondent submission save error',
      meta: {
        action: 'onMultirespondentSubmissionFailure',
        ...createReqMeta(req),
      },
      error: err,
    })
    return res.status(StatusCodes.BAD_REQUEST).json({
      message:
        'Could not send submission. For assistance, please contact the person who asked you to fill in this form.',
      submissionId: submission._id,
    })
  }

  const submissionId = submission.id
  logger.info({
    message: 'Saved submission to MongoDB',
    meta: {
      ...logMeta,
      submissionId,
      formId,
      responseMetadata,
    },
  })

  // TODO 6395 make responseMetadata mandatory
  if (responseMetadata) {
    reportSubmissionResponseTime(responseMetadata, {
      mode: 'multirespodent',
      payment: 'false',
    })
  }

  // Send success back to client
  res.json({
    message: 'Form submission successful.',
    submissionId,
    timestamp: (submission.created || new Date()).getTime(),
  })

  // TODO(MRF/FRM-1591): Add post-submission actions handling
  // return await performEncryptPostSubmissionActions(submission, responses)

  try {
    await runMultirespondentWorkflow({
      nextWorkflowStep: submissionContent.workflowStep + 1, // we want to send emails to the addresses linked to the next step of the workflow
      formWorkflow: form.workflow ?? [],
      formTitle: form.title,
      responseUrl: `${appUrl}/${getMultirespondentSubmissionEditPath(
        form._id,
        submissionId,
        { key: submissionSecretKey },
      )}`,
      formId: form._id,
      submissionId,
    })
  } catch (err) {
    logger.error({
      message: 'Send multirespondent workflow email error',
      meta: {
        ...logMeta,
        ...createReqMeta(req),
        currentWorkflowStep: submissionContent.workflowStep,
        formId: form._id,
        submissionId,
      },
      error: err,
    })
  }
}

const runMultirespondentWorkflow = async ({
  nextWorkflowStep,
  formWorkflow,
  formTitle,
  responseUrl,
  formId,
  submissionId,
}: {
  nextWorkflowStep: number
  formWorkflow: FormWorkflowSettings
  formTitle: string
  responseUrl: string
  formId: string
  submissionId: string
}) => {
  const logMeta = {
    action: 'runMultirespondentWorkflow',
    formId,
    submissionId,
    nextWorkflowStep,
  }
  // Step 1: Retrieve email addresses for current workflow step
  if ((formWorkflow[nextWorkflowStep]?.emails?.length ?? 0) === 0) return
  const emails = formWorkflow[nextWorkflowStep].emails
  // Step 2: send out workflow email
  try {
    await MailService.sendMRFWorkflowStepEmail({
      formTitle,
      emails,
      responseUrl,
    })
  } catch (error) {
    logger.error({
      message: 'Failed to send workflow email',
      meta: { ...logMeta, emails },
    })
  }
}

const updateMultirespondentSubmission = async (
  req: UpdateMultirespondentSubmissionHandlerRequest,
  res: Parameters<UpdateMultirespondentSubmissionHandlerType>[1],
) => {
  const { formId, submissionId } = req.params

  const logMeta = {
    action: 'updateMultirespondentSubmission',
    ...createReqMeta(req),
    formId,
  }

  const form = req.formsg.formDef

  setFormTags(form)

  const ensurePipeline = new Pipeline(
    ensurePublicForm,
    ensureValidCaptcha,
    ensureFormWithinSubmissionLimits,
  )

  const hasEnsuredAll = await ensurePipeline.execute({
    form,
    logMeta,
    req,
    res,
  })

  if (!hasEnsuredAll) {
    if (!res.headersSent) {
      const { errorMessage, statusCode } = mapRouteError(
        new SubmissionFailedError(),
      )
      return res.status(statusCode).json({ message: errorMessage })
    }
    return // required to stop submission processing
  }

  const encryptedPayload = req.formsg.encryptedPayload

  // Create Incoming Submission
  const {
    responseMetadata,
    submissionPublicKey,
    encryptedSubmissionSecretKey,
    encryptedContent,
    submissionSecretKey,
    version,
    workflowStep,
  } = encryptedPayload

  // Save Responses to Database
  // TODO(MRF/FRM-1590): Handle attachments for respondent 2+
  // let attachmentMetadata = new Map<string, string>()

  // if (encryptedPayload.attachments) {
  //   const attachmentUploadResult = await uploadAttachments(
  //     form._id,
  //     encryptedPayload.attachments,
  //   )

  //   if (attachmentUploadResult.isErr()) {
  //     const { statusCode, errorMessage } = mapRouteError(
  //       attachmentUploadResult.error,
  //     )
  //     return res.status(statusCode).json({
  //       message: errorMessage,
  //     })
  //   } else {
  //     attachmentMetadata = attachmentUploadResult.value
  //   }
  // }

  const submission = await MultirespondentSubmission.findById(submissionId)
  if (!submission) {
    return res.status(StatusCodes.NOT_FOUND).json({
      message: 'Not found',
    })
  }

  submission.responseMetadata = responseMetadata
  submission.submissionPublicKey = submissionPublicKey
  submission.encryptedSubmissionSecretKey = encryptedSubmissionSecretKey
  submission.encryptedContent = encryptedContent
  submission.version = version
  submission.workflowStep = workflowStep
  // submission.attachmentMetadata = attachmentMetadata

  try {
    await submission.save()
  } catch (err) {
    logger.error({
      message: 'Encrypt submission save error',
      meta: {
        action: 'onEncryptSubmissionFailure',
        ...createReqMeta(req),
      },
      error: err,
    })
    return res.status(StatusCodes.BAD_REQUEST).json({
      message:
        'Could not send submission. For assistance, please contact the person who asked you to fill in this form.',
      submissionId,
    })
  }

  logger.info({
    message: 'Saved submission to MongoDB',
    meta: {
      ...logMeta,
      submissionId,
      formId,
      responseMetadata,
    },
  })

  // Send success back to client
  res.json({
    message: 'Form submission successful.',
    submissionId,
    timestamp: (submission.created || new Date()).getTime(),
  })

  try {
    await runMultirespondentWorkflow({
      nextWorkflowStep: workflowStep + 1, // we want to send emails to the addresses linked to the next step of the workflow
      formWorkflow: form.workflow ?? [],
      formTitle: form.title,
      responseUrl: `${appUrl}/${getMultirespondentSubmissionEditPath(
        form._id,
        submissionId,
        { key: submissionSecretKey },
      )}`,
      formId: form._id,
      submissionId,
    })
  } catch (err) {
    logger.error({
      message: 'Send multirespondent workflow email error',
      meta: {
        ...logMeta,
        ...createReqMeta(req),
        currentWorkflowStep: workflowStep,
        formId: form._id,
        submissionId,
      },
      error: err,
    })
  }
}

export const handleMultirespondentSubmission = [
  CaptchaMiddleware.validateCaptchaParams,
  TurnstileMiddleware.validateTurnstileParams,
  ReceiverMiddleware.receiveMultirespondentSubmission,
  MultirespondentSubmissionMiddleware.validateMultirespondentSubmissionParams,
  MultirespondentSubmissionMiddleware.createFormsgAndRetrieveForm,
  MultirespondentSubmissionMiddleware.scanAndRetrieveAttachments,
  // TODO(MRF/FRM-1592): Add validation for FieldResponsesV3
  // EncryptSubmissionMiddleware.validateStorageSubmission,
  MultirespondentSubmissionMiddleware.encryptSubmission,
  submitMultirespondentForm,
] as ControllerHandler[]

export const handleUpdateMultirespondentSubmission = [
  CaptchaMiddleware.validateCaptchaParams,
  TurnstileMiddleware.validateTurnstileParams,
  ReceiverMiddleware.receiveMultirespondentSubmission,
  MultirespondentSubmissionMiddleware.validateMultirespondentSubmissionParams,
  MultirespondentSubmissionMiddleware.createFormsgAndRetrieveForm,
  MultirespondentSubmissionMiddleware.scanAndRetrieveAttachments,
  // EncryptSubmissionMiddleware.validateStorageSubmission,
  MultirespondentSubmissionMiddleware.setCurrentWorkflowStep,
  MultirespondentSubmissionMiddleware.encryptSubmission,
  updateMultirespondentSubmission,
] as ControllerHandler[]

/**
 * Handler for GET /forms/:formId/submissions/:submissionId
 * @returns 200 with encrypted submission data response
 * @returns 400 when form is not an encrypt mode form
 * @returns 404 when submissionId cannot be found in the database
 * @returns 404 when form cannot be found
 * @returns 410 when form is archived
 * @returns 500 when any errors occurs in database query, generating signed URL or retrieving payment data
 */
export const handleGetMultirespondentSubmissionForRespondent: ControllerHandler<
  { formId: string; submissionId: string },
  MultirespondentSubmissionDto | ErrorDto
> = async (req, res) => {
  const { formId, submissionId } = req.params

  const logMeta = {
    action: 'handleGetMultirespondentSubmissionForRespondent',
    submissionId,
    formId,
    ...createReqMeta(req),
  }

  logger.info({
    message: 'Get encrypted response using submissionId start',
    meta: logMeta,
  })

  return (
    // Step 1: Retrieve the full form object.
    FormService.retrieveFullFormById(formId)
      //Step 2: Check whether form is archived.
      .andThen((form) => assertFormAvailable(form).map(() => form))
      // Step 3: Check whether form is multirespondent mode.
      .andThen(checkFormIsMultirespondent)
      // Step 4: Is multirespondent mode form, retrieve submission data.
      .andThen((form) =>
        getEncryptedSubmissionData(form.responseMode, formId, submissionId),
      )
      // Step 6: Retrieve presigned URLs for attachments.
      .andThen((submissionData) => {
        if (submissionData.submissionType !== SubmissionType.Multirespondent) {
          return errAsync(new InvalidSubmissionTypeError())
        }

        // Remaining login duration in seconds.
        const urlExpiry = (req.session?.cookie.maxAge ?? 0) / 1000
        return transformAttachmentMetasToSignedUrls(
          submissionData.attachmentMetadata,
          urlExpiry,
        ).map((presignedUrls) =>
          createMultirespondentSubmissionDto(submissionData, presignedUrls),
        )
      })
      .map((responseData) => {
        logger.info({
          message: 'Get encrypted response using submissionId success',
          meta: logMeta,
        })
        return res.json(responseData)
      })
      .mapErr((error) => {
        logger.error({
          message: 'Failure retrieving encrypted submission response',
          meta: logMeta,
          error,
        })

        const { statusCode, errorMessage } = mapRouteError(error)
        return res.status(statusCode).json({
          message: errorMessage,
        })
      })
  )
}
