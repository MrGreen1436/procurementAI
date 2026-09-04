import pandas as pd
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense
from sklearn.preprocessing import MinMaxScaler
import joblib

# Set random seed for reproducibility
tf.random.set_seed(42)
np.random.seed(42)

# Parameters
SEQ_LENGTH = 14
HIDDEN_SIZE = 32
EPOCHS = 100
BATCH_SIZE = 16

def create_sequences(data, seq_length):
    xs = []
    ys = []
    for i in range(len(data)-seq_length):
        x = data[i:(i+seq_length)]
        y = data[i+seq_length]
        xs.append(x)
        ys.append(y)
    return np.array(xs), np.array(ys)

def train_model():
    print("Loading data...")
    df = pd.read_csv("demand_sample.csv")
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values(by=['sku_id', 'date'])
    
    scalers = {}
    
    all_x = []
    all_y = []
    
    print("Preparing sequences...")
    for sku in df['sku_id'].unique():
        sku_data = df[df['sku_id'] == sku]['demand'].values.reshape(-1, 1)
        
        scaler = MinMaxScaler(feature_range=(0, 1))
        sku_data_scaled = scaler.fit_transform(sku_data)
        scalers[sku] = scaler
        
        if len(sku_data_scaled) > SEQ_LENGTH:
            x, y = create_sequences(sku_data_scaled, SEQ_LENGTH)
            all_x.append(x)
            all_y.append(y)
            
    X_train = np.vstack(all_x)
    y_train = np.vstack(all_y)
    
    print(f"Training LSTM on {len(X_train)} samples...")
    
    model = Sequential([
        LSTM(HIDDEN_SIZE, activation='relu', input_shape=(SEQ_LENGTH, 1)),
        Dense(1)
    ])
    
    model.compile(optimizer='adam', loss='mse')
    
    model.fit(X_train, y_train, epochs=EPOCHS, batch_size=BATCH_SIZE, verbose=1)
            
    print("Saving model and scalers...")
    model.save("lstm_model.h5")
    joblib.dump(scalers, "lstm_scalers.pkl")
    print("Done!")

if __name__ == "__main__":
    train_model()
