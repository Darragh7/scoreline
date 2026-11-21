from fastapi import APIRouter, Depends

from app.services.prediction_service import PredictionService


router = APIRouter(
    prefix="/predictions",
    tags=["Predictions"]
)


def get_prediction_service() -> PredictionService:
    return PredictionService()


@router.get("/{match_id}")
def get_prediction(
    match_id: int,
    prediction_service: PredictionService = Depends(get_prediction_service),
):
    prediction = prediction_service.predict(match_id)

    return {
        "match_id": match_id,
        "prediction": prediction
    }
