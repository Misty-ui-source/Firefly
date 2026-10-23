export type ProfileConfig = {
	avatar?: string;
	avatarUseAnimated?: boolean;
	name: string;
	bio?: string;
	links: {
		name: string;
		url: string;
		icon: string;
		showName?: boolean;
	}[];
};
