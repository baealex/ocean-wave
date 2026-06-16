import models from '~/models';
import { connectors } from '~/socket/connectors';
import { TAG_LIST_INVALIDATED } from '~/socket/tag';

import {
    createCreateSmartViewMutationResolver,
    createDeleteSmartViewMutationResolver,
    createRenameSmartViewMutationResolver
} from './smart-view.mutation.resolver';

describe('smart view mutation resolvers', () => {
    beforeEach(async () => {
        jest.restoreAllMocks();

        await models.smartViewTag.deleteMany();
        await models.smartView.deleteMany();
        await models.musicTag.deleteMany();
        await models.tag.deleteMany();
    });

    it('creates a view and notifies smart view invalidation', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const resolver = createCreateSmartViewMutationResolver();

        const result = await resolver(null, {
            name: 'Focus View',
            tagIds: [tag.id.toString()],
            tagMode: 'all',
            originClientId: 'client-1'
        });

        expect(result.name).toBe('Focus View');
        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'smart-views-changed',
            affectedSmartViewIds: [result.id.toString()],
            originClientId: 'client-1'
        });
    });

    it('renames and deletes a view with notifications', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });
        const view = await models.smartView.create({
            data: {
                name: 'Focus View',
                normalizedName: 'focus view',
                SmartViewTag: {
                    create: {
                        tagId: tag.id
                    }
                }
            }
        });
        const notifySpy = jest.spyOn(connectors, 'notify').mockImplementation();
        const renameResolver = createRenameSmartViewMutationResolver();
        const deleteResolver = createDeleteSmartViewMutationResolver();

        await expect(renameResolver(null, {
            id: view.id.toString(),
            name: 'Deep Focus'
        })).resolves.toEqual(expect.objectContaining({
            name: 'Deep Focus'
        }));
        await expect(deleteResolver(null, {
            id: view.id.toString()
        })).resolves.toEqual({
            id: view.id.toString()
        });

        expect(notifySpy).toHaveBeenCalledWith(TAG_LIST_INVALIDATED, {
            reason: 'smart-views-changed',
            affectedSmartViewIds: [view.id.toString()]
        });
    });
});
