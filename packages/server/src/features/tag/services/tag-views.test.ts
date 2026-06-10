import models from '~/models';

import {
    createTagView,
    deleteTagView,
    renameTagView,
    TAG_VIEW_ERROR_CODE
} from './tag-views';

describe('tag view service', () => {
    beforeEach(async () => {
        await models.smartViewTag.deleteMany();
        await models.smartView.deleteMany();
        await models.musicTag.deleteMany();
        await models.tag.deleteMany();
    });

    it('creates a view with normalized name and ordered tags', async () => {
        const firstTag = await models.tag.create({
            data: {
                name: 'Dreamy',
                normalizedName: 'dreamy'
            }
        });
        const secondTag = await models.tag.create({
            data: {
                name: 'Night',
                normalizedName: 'night'
            }
        });

        const view = await createTagView({
            name: '  Night   Drive  ',
            tagIds: [firstTag.id.toString(), secondTag.id.toString()],
            tagMode: 'all'
        });
        const viewTags = await models.smartViewTag.findMany({
            where: { smartViewId: view.id },
            orderBy: { order: 'asc' }
        });

        expect(view).toEqual(expect.objectContaining({
            name: 'Night Drive',
            normalizedName: 'night drive',
            tagMode: 'all'
        }));
        expect(viewTags.map(viewTag => viewTag.tagId)).toEqual([firstTag.id, secondTag.id]);
    });

    it('rejects duplicate view names', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Focus',
                normalizedName: 'focus'
            }
        });

        await createTagView({
            name: 'Focus View',
            tagIds: [tag.id.toString()],
            tagMode: 'all'
        });

        await expect(createTagView({
            name: 'focus view',
            tagIds: [tag.id.toString()],
            tagMode: 'any'
        })).rejects.toMatchObject({
            code: TAG_VIEW_ERROR_CODE.viewNameConflict
        });
    });

    it('renames and deletes a view', async () => {
        const tag = await models.tag.create({
            data: {
                name: 'Bath',
                normalizedName: 'bath'
            }
        });
        const view = await createTagView({
            name: 'Bath',
            tagIds: [tag.id.toString()],
            tagMode: 'any'
        });

        await expect(renameTagView({
            id: view.id.toString(),
            name: 'Bath Time'
        })).resolves.toEqual(expect.objectContaining({
            name: 'Bath Time',
            normalizedName: 'bath time'
        }));
        await expect(deleteTagView({ id: view.id.toString() })).resolves.toEqual({
            id: view.id.toString()
        });
        await expect(models.smartView.count()).resolves.toBe(0);
    });
});
