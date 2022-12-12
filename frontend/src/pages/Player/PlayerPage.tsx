import 'rc-slider/assets/index.css'

import { useAuthContext } from '@authentication/AuthContext'
import ButtonLink from '@components/Button/ButtonLink/ButtonLink'
import ElevatedCard from '@components/ElevatedCard/ElevatedCard'
import { ErrorState } from '@components/ErrorState/ErrorState'
import FullBleedCard from '@components/FullBleedCard/FullBleedCard'
import { useIsSessionPendingQuery } from '@graph/hooks'
import { Session } from '@graph/schemas'
import { Replayer } from '@highlight-run/rrweb'
import LoadingLiveSessionCard from '@pages/Player/components/LoadingLiveSessionCard/LoadingLiveSessionCard'
import NoActiveSessionCard from '@pages/Player/components/NoActiveSessionCard/NoActiveSessionCard'
import PanelToggleButton from '@pages/Player/components/PanelToggleButton/PanelToggleButton'
import UnauthorizedViewingForm from '@pages/Player/components/UnauthorizedViewingForm/UnauthorizedViewingForm'
import { PlayerUIContextProvider } from '@pages/Player/context/PlayerUIContext'
import { HighlightEvent } from '@pages/Player/HighlightEvent'
import PlayerCommentCanvas, {
	Coordinates2D,
} from '@pages/Player/PlayerCommentCanvas/PlayerCommentCanvas'
import { usePlayer } from '@pages/Player/PlayerHook/PlayerHook'
import { SessionViewability } from '@pages/Player/PlayerHook/PlayerState'
import usePlayerConfiguration from '@pages/Player/PlayerHook/utils/usePlayerConfiguration'
import PlayerPageProductTour from '@pages/Player/PlayerPageProductTour/PlayerPageProductTour'
import {
	ReplayerContextProvider,
	ReplayerState,
} from '@pages/Player/ReplayerContext'
import {
	ResourcesContextProvider,
	useResources,
} from '@pages/Player/ResourcesContext/ResourcesContext'
import RightPlayerPanel, {
	DUAL_PANEL_VIEWPORT_THRESHOLD,
} from '@pages/Player/RightPlayerPanel/RightPlayerPanel'
import SearchPanel from '@pages/Player/SearchPanel/SearchPanel'
import SessionLevelBar from '@pages/Player/SessionLevelBar/SessionLevelBar'
import DetailPanel from '@pages/Player/Toolbar/DevToolsWindow/DetailPanel/DetailPanel'
import { NewCommentModal } from '@pages/Player/Toolbar/NewCommentModal/NewCommentModal'
import { Toolbar } from '@pages/Player/Toolbar/Toolbar'
import { usePlayerFullscreen } from '@pages/Player/utils/PlayerHooks'
import { IntegrationCard } from '@pages/Sessions/IntegrationCard/IntegrationCard'
import { getDisplayName } from '@pages/Sessions/SessionsFeedV2/components/MinimalSessionCard/utils/utils'
import useLocalStorage from '@rehooks/local-storage'
import { useApplicationContext } from '@routers/OrgRouter/ApplicationContext'
import analytics from '@util/analytics'
import { isOnPrem } from '@util/onPrem/onPremUtils'
import { useParams } from '@util/react-router/useParams'
import classNames from 'classnames'
import Lottie from 'lottie-react'
import React, {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { Helmet } from 'react-helmet'
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton'
import useResizeAware from 'react-resize-aware'
import { useWindowSize } from 'react-use'

import WaitingAnimation from '../../lottie/waiting.json'
import styles from './PlayerPage.module.scss'

interface Props {
	integrated: boolean
}

export const LEFT_PANEL_WIDTH = 475
export const RIGHT_PANEL_WIDTH = 350

const CENTER_COLUMN_MARGIN = 16
const MIN_CENTER_COLUMN_WIDTH = 428

const PlayerPage = ({ integrated }: Props) => {
	const { isLoggedIn } = useAuthContext()
	const { currentWorkspace } = useApplicationContext()
	const { session_secure_id } = useParams<{
		session_secure_id: string
	}>()

	const [resizeListener, sizes] = useResizeAware()

	const player = usePlayer()
	const {
		state: replayerState,
		setScale,
		replayer,
		time,
		sessionViewability,
		isPlayerReady,
		session,
		currentUrl,
	} = player

	const { data: isSessionPendingData, loading } = useIsSessionPendingQuery({
		variables: {
			session_secure_id,
		},
		skip: sessionViewability !== SessionViewability.ERROR,
	})

	const resources = useResources(session)
	const {
		setShowRightPanel,
		setShowLeftPanel,
		showLeftPanel: showLeftPanelPreference,
	} = usePlayerConfiguration()
	const playerWrapperRef = useRef<HTMLDivElement>(null)
	const { isPlayerFullscreen, setIsPlayerFullscreen, playerCenterPanelRef } =
		usePlayerFullscreen()
	const [detailedPanel, setDetailedPanel] = useState<
		| {
				title: string | React.ReactNode
				content: React.ReactNode
				id: string
		  }
		| undefined
	>(undefined)
	const newCommentModalRef = useRef<HTMLDivElement>(null)
	const [commentModalPosition, setCommentModalPosition] = useState<
		Coordinates2D | undefined
	>(undefined)
	const [commentPosition, setCommentPosition] = useState<
		Coordinates2D | undefined
	>(undefined)
	const [activeEvent, setActiveEvent] = useState<HighlightEvent | undefined>(
		undefined,
	)
	const [selectedRightPanelTab, setSelectedRightPanelTab] = useLocalStorage<
		'Events' | 'Comments' | 'Metadata'
	>('tabs-PlayerRightPanel-active-tab', 'Events')

	useEffect(() => {
		if (!session_secure_id) {
			setShowLeftPanel(true)
		}
	}, [session_secure_id, setShowLeftPanel])

	const resizePlayer = useCallback(
		(replayer: Replayer): boolean => {
			const width = replayer?.wrapper?.getBoundingClientRect().width
			const height = replayer?.wrapper?.getBoundingClientRect().height
			const targetWidth = playerWrapperRef.current?.clientWidth
			const targetHeight = playerWrapperRef.current?.clientHeight
			if (!width || !targetWidth || !height || !targetHeight) {
				return false
			}
			const widthScale = (targetWidth - 80) / width
			const heightScale = (targetHeight - 80) / height
			const scale = Math.min(heightScale, widthScale)
			// If calculated scale is close enough to 1, return to avoid
			// infinite looping caused by small floating point math differences
			if (scale >= 0.9999 && scale <= 1.0001) {
				return true
			}

			if (scale <= 0) {
				return false
			}

			setScale((s) => {
				const replayerScale = s * scale

				// why translate -50 -50 -> https://medium.com/front-end-weekly/absolute-centering-in-css-ea3a9d0ad72e
				replayer?.wrapper?.setAttribute(
					'style',
					`transform: scale(${replayerScale}) translate(-50%, -50%)`,
				)

				return replayerScale
			})
			return true
		},
		[setScale],
	)

	// This adjusts the dimensions (i.e. scale()) of the iframe when the page loads.
	useEffect(() => {
		const i = window.setInterval(() => {
			if (replayer && resizePlayer(replayer)) {
				clearInterval(i)
			}
		}, 1000 / 60)
		return () => {
			i && clearInterval(i)
		}
	}, [resizePlayer, replayer])

	const playerBoundingClientRectWidth =
		replayer?.wrapper?.getBoundingClientRect().width
	const playerBoundingClientRectHeight =
		replayer?.wrapper?.getBoundingClientRect().height

	// On any change to replayer, 'sizes', refresh the size of the player.
	useEffect(() => {
		replayer && resizePlayer(replayer)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		sizes,
		replayer,
		playerBoundingClientRectWidth,
		playerBoundingClientRectHeight,
	])

	useEffect(() => analytics.page(), [session_secure_id])

	const showLeftPanel =
		showLeftPanelPreference &&
		sessionViewability !== SessionViewability.OVER_BILLING_QUOTA

	const [centerColumnResizeListener, centerColumnSize] = useResizeAware()
	const controllerWidth = Math.max(
		MIN_CENTER_COLUMN_WIDTH,
		(centerColumnSize.width || 0) - 2 * CENTER_COLUMN_MARGIN,
	)

	const playerFiller = useMemo(() => {
		const playerHeight =
			playerWrapperRef.current?.getBoundingClientRect().height
		const height = ((playerHeight ?? 0) * 3) / 5
		return (
			<div className={styles.loadingWrapper}>
				<PlayerSkeleton width={controllerWidth} height={height} />
			</div>
		)
	}, [controllerWidth])

	const { width: windowWidth } = useWindowSize()

	const replayerWrapperBbox = replayer?.wrapper.getBoundingClientRect()
	return (
		<PlayerUIContextProvider
			value={{
				isPlayerFullscreen,
				setIsPlayerFullscreen,
				playerCenterPanelRef,
				detailedPanel,
				setDetailedPanel,
				selectedRightPanelTab,
				setSelectedRightPanelTab,
				activeEvent,
				setActiveEvent,
			}}
		>
			<Helmet>
				<title>{getTabTitle(session)}</title>
			</Helmet>
			<ReplayerContextProvider value={player}>
				{!integrated && <IntegrationCard />}
				{isPlayerReady && !isLoggedIn && (
					<>
						<Suspense fallback={null}>
							<PlayerPageProductTour />
						</Suspense>
					</>
				)}
				<div
					className={classNames(
						styles.playerBody,
						styles.gridBackground,
						{
							[styles.withLeftPanel]: showLeftPanel,
						},
					)}
				>
					<div
						className={classNames(styles.playerLeftPanel, {
							[styles.hidden]: !showLeftPanel,
						})}
					>
						<SearchPanel visible={showLeftPanel} />
						{isLoggedIn && (
							<PanelToggleButton
								className={classNames(
									styles.panelToggleButton,
									styles.panelToggleButtonLeft,
									{
										[styles.panelShown]:
											showLeftPanelPreference,
									},
								)}
								direction="left"
								isOpen={showLeftPanelPreference}
								onClick={() => {
									if (
										!showLeftPanelPreference &&
										windowWidth <=
											DUAL_PANEL_VIEWPORT_THRESHOLD
									) {
										setShowRightPanel(false)
									}

									setShowLeftPanel(!showLeftPanelPreference)
								}}
							/>
						)}
					</div>
					{sessionViewability ===
						SessionViewability.OVER_BILLING_QUOTA && (
						<FullBleedCard
							title="Session quota reached 😔"
							animation={
								<Lottie animationData={WaitingAnimation} />
							}
						>
							<p>
								This session was recorded after you reached your
								session quota. To view it, upgrade your plan.
							</p>
							<ButtonLink
								to={`/w/${currentWorkspace?.id}/upgrade-plan`}
								trackingId="PlayerPageUpgradePlan"
								className={styles.center}
							>
								Upgrade Plan
							</ButtonLink>
						</FullBleedCard>
					)}
					<UnauthorizedViewingForm />
					{sessionViewability === SessionViewability.ERROR ? (
						loading ? (
							playerFiller
						) : isSessionPendingData?.isSessionPending ? (
							<ErrorState
								shownWithHeader
								title="This session is on the way!"
								message="We are processing the data and will show the recording here soon. Please come back in a minute."
							/>
						) : (
							<ErrorState
								shownWithHeader
								message="This session does not exist or has not been made public."
							/>
						)
					) : sessionViewability ===
					  SessionViewability.EMPTY_SESSION ? (
						<ElevatedCard
							className={styles.emptySessionCard}
							title="Session isn't ready to view yet 😔"
							animation={
								<Lottie animationData={WaitingAnimation} />
							}
						>
							<p>
								We need more time to process this session.{' '}
								{!isOnPrem ? (
									<>
										If this looks like a bug, shoot us a
										message on{' '}
										<span
											className={styles.intercomLink}
											onClick={() => {
												window.Intercom(
													'showNewMessage',
													`I'm seeing an empty session. This is the session ID: "${session_secure_id}"`,
												)
											}}
										>
											Intercom
										</span>
										.
									</>
								) : (
									<>
										If this looks like a bug, please reach
										out to us!
									</>
								)}
							</p>
						</ElevatedCard>
					) : (sessionViewability === SessionViewability.VIEWABLE &&
							!!session) ||
					  replayerState !== ReplayerState.Empty ||
					  (replayerState === ReplayerState.Empty &&
							!!session_secure_id) ? (
						<div
							id="playerCenterPanel"
							className={classNames(styles.playerCenterPanel, {
								[styles.gridBackground]: isPlayerFullscreen,
							})}
							ref={playerCenterPanelRef}
						>
							<div className={styles.playerContainer}>
								<div className={styles.rrwebPlayerSection}>
									<div className={styles.playerCenterColumn}>
										{centerColumnResizeListener}
										{!isPlayerFullscreen && (
											<SessionLevelBar
												width={controllerWidth}
											/>
										)}
										<div
											className={
												styles.rrwebPlayerWrapper
											}
											ref={playerWrapperRef}
										>
											{resizeListener}
											{replayerState ===
												ReplayerState.SessionRecordingStopped && (
												<div
													className={
														styles.manuallyStoppedMessageContainer
													}
													style={{
														height: replayerWrapperBbox?.height,
														width: replayerWrapperBbox?.width,
													}}
												>
													<ElevatedCard title="Session recording manually stopped">
														<p>
															<a
																href="https://docs.highlight.run/api/hstop"
																target="_blank"
																rel="noreferrer"
															>
																<code>
																	H.stop()
																</code>
															</a>{' '}
															was called during
															the session. Calling
															this method stops
															the session
															recording. If you
															expect the recording
															to continue please
															check where you are
															calling{' '}
															<a
																href="https://docs.highlight.run/api/hstop"
																target="_blank"
																rel="noreferrer"
															>
																<code>
																	H.stop()
																</code>
															</a>
															.
														</p>
													</ElevatedCard>
												</div>
											)}
											<div
												style={{
													visibility: isPlayerReady
														? 'visible'
														: 'hidden',
												}}
												className="highlight-block"
												id="player"
											/>
											<PlayerCommentCanvas
												setModalPosition={
													setCommentModalPosition
												}
												modalPosition={
													commentModalPosition
												}
												setCommentPosition={
													setCommentPosition
												}
											/>
											{!isPlayerReady &&
												sessionViewability ===
													SessionViewability.VIEWABLE &&
												(session?.processed ===
												false ? (
													<LoadingLiveSessionCard />
												) : (
													playerFiller
												))}
										</div>
										<ResourcesContextProvider
											value={resources}
										>
											<Toolbar width={controllerWidth} />
										</ResourcesContextProvider>
									</div>

									{!isPlayerFullscreen && (
										<>
											<RightPlayerPanel />
											<ResourcesContextProvider
												value={resources}
											>
												<DetailPanel />
											</ResourcesContextProvider>
										</>
									)}
								</div>
							</div>
						</div>
					) : (
						<NoActiveSessionCard />
					)}
					<NewCommentModal
						newCommentModalRef={newCommentModalRef}
						commentModalPosition={commentModalPosition}
						commentPosition={commentPosition}
						commentTime={time}
						session={session}
						session_secure_id={session_secure_id}
						onCancel={() => {
							setCommentModalPosition(undefined)
						}}
						currentUrl={currentUrl}
					/>
				</div>
			</ReplayerContextProvider>
		</PlayerUIContextProvider>
	)
}

const PlayerSkeleton = ({
	width,
	height,
}: {
	width: number
	height: number
}) => {
	return (
		<SkeletonTheme
			baseColor="var(--text-primary-inverted)"
			highlightColor="#f5f5f5"
		>
			<Skeleton
				height={height}
				width={width - 2 * CENTER_COLUMN_MARGIN}
				duration={1}
			/>
		</SkeletonTheme>
	)
}

export default PlayerPage

const getTabTitle = (session?: Session) => {
	if (!session) {
		return 'Sessions'
	}
	return `Sessions: ${getDisplayName(session)}`
}
